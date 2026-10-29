/**
 * FILE: fresh-eyes-routes.test.ts
 * PURPOSE: Fresh-eyes routes (ADR 0053) through the real handlers on an
 *          in-memory database: only an operator mints a test account, never
 *          through a project key or from a synthetic account; the account is
 *          confirmed, flagged and listed for exclusion, or deleted again; a
 *          run upserts as kind fresh_eyes and writes its metric rows once;
 *          screenshots stay in the run's folder; findings file as
 *          `fresh_eyes` reports, deduped by fingerprint and capped.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1a000000-0000-4000-8000-000000000000'
const OTHER = '1b000000-0000-4000-8000-000000000000'
const RUN = '20261027-210000-ab12'
const OPERATOR = '0f000000-0000-4000-8000-00000000000a'
const SELF = '0e000000-0000-4000-8000-00000000000e'

const state = vi.hoisted(() => ({
  db: null as unknown,
  members: new Set<string>(),
  role: 'admin' as string | null,
  created: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  audits: [] as unknown[],
}))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async (...a: unknown[]) => void state.audits.push(a) }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const l = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => l }
  return { log: l }
})
vi.mock('../../supabase/functions/_shared/quota.ts', () => ({ checkIngestQuota: async () => ({ allowed: true, plan: { display_name: 'Hobby' } }) }))
vi.mock('../../supabase/functions/_shared/report-classification.ts', () => ({ queueReportClassification: async () => undefined }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) => c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  jsonError: (c: { json: (b: unknown, s: number) => unknown }, code: string, message: string, status = 400) => c.json({ ok: false, error: { code, message } }, status),
  callerCanAccessProject: async (_c: unknown, _db: unknown, _u: string, projectId: string) => ({ allowed: state.members.has(projectId), role: state.role }),
}))

let routes: typeof import('../../supabase/functions/api/routes/fresh-eyes.ts')
beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => ({ MUSHI_OPERATOR_USER_IDS: OPERATOR, MUSHI_SELF_PROJECT_ID: SELF })[k] } })
  routes = await import('../../supabase/functions/api/routes/fresh-eyes.ts')
})
afterAll(() => vi.unstubAllGlobals())

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } } }
type Handler = (c: unknown) => Promise<unknown>
interface Caller {
  userId?: string
  authMethod?: 'jwt' | 'apiKey'
  isOrgScopedKey?: boolean
  keyAllowedProjectIds?: string[] | null
  headers?: Record<string, string>
  apiKeyScopes?: string[]
  apiKeyId?: string
}

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  private add(method: string) {
    return (path: string, ...handlers: Handler[]) => this.routes.push({ method, path, handler: handlers[handlers.length - 1]! })
  }
  get = this.add('GET')
  post = this.add('POST')
  put = this.add('PUT')
  async call(method: string, path: string, params: Record<string, string>, body?: unknown, who: Caller = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: 'apiKey', isOrgScopedKey: false, keyAllowedProjectIds: null, ...who }
    const c = {
      req: { json: async () => body, param: (k: string) => params[k], query: () => undefined, header: (k: string) => who.headers?.[k] },
      get: (k: string) => vars[k],
      header: () => undefined,
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handler(c)) as Res
  }
}

function setup(opts: { rpcError?: string | null; failInsert?: string } = {}): { db: FakeDb; app: FakeApp } {
  const db = makeFakeDb(
    { ux_runs: [], reports: [], metric_series: [], synthetic_accounts: [], operator_users: [], usage_events: [] },
    {
      autoId: true,
      uniques: { ux_runs: ['project_id', 'local_run_id'], synthetic_accounts: ['user_id'], operator_users: ['user_id'] },
      rpcError: (fn) => (fn === 'scoped_rate_limit_claim' && opts.rpcError ? { code: 'P0001', message: opts.rpcError } : null),
    },
  )
  const anyDb = db as unknown as Record<string, unknown>
  anyDb.storage = {
    from: () => ({
      createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}?token=t`, token: 't' }, error: null }),
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://storage.test/${p}?read` })), error: null }),
    }),
  }
  anyDb.auth = {
    admin: {
      createUser: async (attrs: Record<string, unknown>) => {
        state.created.push(attrs)
        return { data: { user: { id: '2a000000-0000-4000-8000-000000000001' } }, error: null }
      },
      deleteUser: async (id: string) => {
        state.deleted.push(id)
        return { error: null }
      },
    },
  }
  if (opts.failInsert) {
    const from = db.from.bind(db)
    anyDb.from = (t: string) => {
      const q = from(t)
      if (t === opts.failInsert) (q as unknown as { insert: unknown }).insert = async () => ({ error: { message: 'insert refused' } })
      return q
    }
  }
  state.db = db
  const app = new FakeApp()
  routes.registerFreshEyesRoutes(app as never)
  return { db, app }
}

beforeEach(() => {
  state.members = new Set([P])
  state.role = 'admin'
  state.created = []
  state.deleted = []
  state.audits = []
})

const MINT = '/v1/admin/fresh-eyes/test-account'
const operatorJwt: Caller = { userId: OPERATOR, authMethod: 'jwt' }

describe('POST /v1/admin/fresh-eyes/test-account', () => {
  it('refuses anyone who is not an operator', async () => {
    const { app } = setup()
    const r = await app.call('POST', MINT, {}, {}, { userId: 'someone-else', authMethod: 'jwt' })
    expect(r.status).toBe(403)
    expect(state.created).toHaveLength(0)
  })

  it('refuses a key bound to one project, even an operator key', async () => {
    const { app } = setup()
    expect((await app.call('POST', MINT, {}, {}, { userId: OPERATOR, authMethod: 'apiKey', isOrgScopedKey: false })).status).toBe(403)
    expect((await app.call('POST', MINT, {}, {}, { userId: OPERATOR, authMethod: 'apiKey', isOrgScopedKey: true, keyAllowedProjectIds: [P] })).status).toBe(403)
    expect(state.created).toHaveLength(0)
  })

  it('refuses a synthetic account', async () => {
    const { db, app } = setup()
    db.tables.synthetic_accounts!.push({ user_id: OPERATOR, email: 'x', expires_at: new Date().toISOString() })
    const r = await app.call('POST', MINT, {}, {}, operatorJwt)
    expect(r.status).toBe(403)
    expect(r.body.error?.message).toMatch(/cannot mint/)
  })

  it('makes a confirmed, flagged account, lists it for exclusion and returns the password once', async () => {
    const { db, app } = setup()
    const r = await app.call('POST', MINT, {}, {}, operatorJwt)
    expect(r.status).toBe(200)
    const created = state.created[0]!
    expect(created.email_confirm).toBe(true)
    expect(created.app_metadata).toEqual({ synthetic: true, synthetic_purpose: 'fresh_eyes' })
    expect(String(created.email)).toMatch(/^fresh-eyes-[0-9a-f]{12}@synthetic\.kensaur\.us$/)
    expect(r.body.data?.password).toBe(created.password)
    expect(db.tables.synthetic_accounts).toHaveLength(1)
    expect(db.tables.synthetic_accounts![0]!.created_by).toBe(OPERATOR)
    expect(db.tables.operator_users).toHaveLength(1)
    expect(Date.parse(String(r.body.data?.expires_at)) - Date.now()).toBeGreaterThan(23 * 3_600_000)
    expect(state.audits).toHaveLength(1)
    // The password is never in the audit log.
    expect(JSON.stringify(state.audits)).not.toContain(String(created.password))
  })

  it('deletes the account again when it cannot be flagged', async () => {
    const { app } = setup({ failInsert: 'synthetic_accounts' })
    const r = await app.call('POST', MINT, {}, {}, operatorJwt)
    expect(r.status).toBe(500)
    expect(state.deleted).toEqual(['2a000000-0000-4000-8000-000000000001'])
  })

  it('answers 429 past the hourly cap and makes nothing', async () => {
    const { app } = setup({ rpcError: 'rate_limit_exceeded' })
    const r = await app.call('POST', MINT, {}, {}, operatorJwt)
    expect(r.status).toBe(429)
    expect(state.created).toHaveLength(0)
  })
})

const BASE = '/v1/admin/projects/:pid/fresh-eyes/:runId'

function snapshot(over: Record<string, unknown> = {}) {
  return {
    status: 'done',
    goal: 'get my first bug explained',
    start_url: 'https://x.test/',
    model: 'grok-4.7-high-fast',
    dry_run: false,
    has_account: true,
    started_at: '2026-10-27T21:00:00.000Z',
    finished_at: '2026-10-27T21:20:00.000Z',
    ttfv_seconds: 412.5,
    steps: 14,
    reached: 2,
    stalled_at: { screen: '/admin/onboarding', reason: 'model_gave_up', sessions: 1 },
    findings: [{ fingerprint: 'abcdef0123456789', severity: 'medium', basis: 'measured', summary: 'Setting up needs a terminal at /admin/onboarding', sessions: [1, 2] }],
    sessions: [
      {
        index: 1,
        outcome: 'reached',
        stall: null,
        ttfv_seconds: 400,
        app_seconds: 30,
        read_seconds: 370,
        model_seconds: 600,
        backtracks: 0,
        steps: [
          { n: 0, action: 'Open https://x.test/', path: '/', screen: '/', model_ms: 0, app_ms: 1200, read_ms: 60000, outcome: 'ok', note: null, opinion: null, backtrack: false, dead_end: false, requirements: [], signals: [], shot: 's1-step00.png' },
        ],
      },
    ],
    cli_version: null,
    ...over,
  }
}

describe('PUT a run', () => {
  it('refuses non-members, viewers and malformed snapshots', async () => {
    const { app } = setup()
    expect((await app.call('PUT', BASE, { pid: OTHER, runId: RUN }, snapshot())).status).toBe(403)
    state.role = 'viewer'
    expect((await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot())).status).toBe(403)
    state.role = 'admin'
    expect((await app.call('PUT', BASE, { pid: P, runId: 'explore-2026' }, snapshot())).status).toBe(400)
    expect((await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot({ steps: -1 }))).status).toBe(400)
    // A screenshot name that tries to leave the run folder.
    const bad = snapshot()
    ;(bad.sessions[0]!.steps[0] as { shot: string }).shot = '../other/run.png'
    expect((await app.call('PUT', BASE, { pid: P, runId: RUN }, bad)).status).toBe(400)
  })

  it('upserts kind fresh_eyes and writes the metric rows once', async () => {
    const { db, app } = setup()
    expect((await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot({ status: 'running', finished_at: null }))).status).toBe(200)
    expect(db.tables.metric_series).toHaveLength(0)
    expect((await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot())).status).toBe(200)
    expect((await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot())).status).toBe(200)
    expect(db.tables.ux_runs).toHaveLength(1)
    expect(db.tables.ux_runs![0]).toMatchObject({ kind: 'fresh_eyes', agent: 'fresh-eyes', ttfv_seconds: 412.5, steps: 14, reached: 2 })
    expect(db.tables.metric_series!.map((m) => [m.metric_name, m.value, m.dimension]).sort()).toEqual([
      ['fresh_eyes.steps', 14, RUN],
      ['fresh_eyes.ttfv_seconds', 412.5, RUN],
    ])
  })

  it('a dry run, or a run that never reached the goal, writes no time', async () => {
    const { db, app } = setup()
    await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot({ dry_run: true }))
    expect(db.tables.metric_series).toHaveLength(0)
    await app.call('PUT', BASE, { pid: P, runId: '20261027-220000-cd34' }, snapshot({ ttfv_seconds: null, reached: 0 }))
    expect(db.tables.metric_series!.map((m) => m.metric_name)).toEqual(['fresh_eyes.steps'])
  })

  it('will not overwrite a UX loop run with the same id', async () => {
    const { db, app } = setup()
    db.tables.ux_runs!.push({ id: 'r-loop', project_id: P, local_run_id: RUN, kind: 'loop', status: 'done' })
    expect((await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot())).status).toBe(409)
  })
})

describe('uploads', () => {
  it('signs only screenshot names the CLI makes, inside the run folder', async () => {
    const { db, app } = setup()
    await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot())
    const runId = String(db.tables.ux_runs![0]!.id)
    const ok = await app.call('POST', `${BASE}/uploads`, { pid: P, runId: RUN }, { names: ['s1-step00.png', 's3-step12.png'] })
    expect(ok.status).toBe(200)
    expect(JSON.stringify(ok.body.data)).toContain(`${P}/${runId}/fresh-eyes/s1-step00.png`)
    expect((await app.call('POST', `${BASE}/uploads`, { pid: P, runId: RUN }, { names: ['../x.png'] })).status).toBe(400)
    expect((await app.call('POST', `${BASE}/uploads`, { pid: P, runId: '20261027-000000-zzzz' }, { names: ['s1-step00.png'] })).status).toBe(404)
  })
})

const finding = (over: Record<string, unknown> = {}) => ({
  fingerprint: 'abcdef0123456789',
  rule: 'fresh-eyes-needs-terminal',
  basis: 'measured',
  title: '/admin/onboarding: Setting up needs a terminal at /admin/onboarding',
  description: 'Steps: …',
  severity: 'low',
  component: '/admin/onboarding',
  ...over,
})

describe('findings', () => {
  it('files a fresh_eyes report, and the same fingerprint is not filed while it is open', async () => {
    const { db, app } = setup()
    await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot())
    const first = await app.call('POST', `${BASE}/findings`, { pid: P, runId: RUN }, finding())
    expect(first.status).toBe(200)
    const report = db.tables.reports![0]!
    expect(report).toMatchObject({ source: 'fresh_eyes', status: 'new', severity: 'low' })
    expect((report.custom_metadata as Record<string, unknown>).fresh_eyes_fingerprint).toBe('abcdef0123456789')
    const again = await app.call('POST', `${BASE}/findings`, { pid: P, runId: RUN }, finding())
    expect(again.body.data).toEqual({ reportId: null, duplicateOf: first.body.data?.reportId })
    expect(db.tables.reports).toHaveLength(1)
    // Fixed: a later run that sees it again files it again.
    report.status = 'fixed'
    expect((await app.call('POST', `${BASE}/findings`, { pid: P, runId: RUN }, finding())).body.data?.reportId).toBeTruthy()
  })

  it('refuses unknown fields and a run that was never synced', async () => {
    const { app } = setup()
    expect((await app.call('POST', `${BASE}/findings`, { pid: P, runId: RUN }, finding({ source: 'sdk' }))).status).toBe(400)
    expect((await app.call('POST', `${BASE}/findings`, { pid: P, runId: RUN }, finding())).status).toBe(404)
  })

  it('caps a run at 15 reports', async () => {
    const { app } = setup()
    await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot())
    for (let i = 0; i < 15; i++) {
      const fp = i.toString(16).padStart(16, '0')
      expect((await app.call('POST', `${BASE}/findings`, { pid: P, runId: RUN }, finding({ fingerprint: fp }))).status).toBe(200)
    }
    expect((await app.call('POST', `${BASE}/findings`, { pid: P, runId: RUN }, finding({ fingerprint: 'ffffffffffffffff' }))).status).toBe(429)
  })
})

describe('GET', () => {
  it('lists only fresh-eyes runs with the trend, and one run with signed screenshots and its reports', async () => {
    const { db, app } = setup()
    db.tables.ux_runs!.push({ id: 'r-loop', project_id: P, local_run_id: '20261001-000000-aaaa', kind: 'loop', status: 'done', started_at: '2026-10-01T00:00:00.000Z' })
    await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot())
    await app.call('POST', `${BASE}/findings`, { pid: P, runId: RUN }, finding())
    const list = await app.call('GET', '/v1/admin/projects/:pid/fresh-eyes', { pid: P })
    expect((list.body.data?.runs as unknown[]).length).toBe(1)
    expect((list.body.data?.trend as unknown[]).length).toBe(2)
    const one = await app.call('GET', BASE, { pid: P, runId: RUN })
    expect(one.status).toBe(200)
    expect(Object.keys(one.body.data?.shots as object)).toEqual(['s1-step00.png'])
    expect((one.body.data?.reports as unknown[]).length).toBe(1)
    expect(one.body.data?.run).not.toHaveProperty('id')
    expect((await app.call('GET', '/v1/admin/projects/:pid/fresh-eyes', { pid: OTHER })).status).toBe(403)
  })
})

// ── Run now: the console queues a test for a local worker (ADR 0053 amendment 2026-10-28) ──

const LIST = '/v1/admin/projects/:pid/fresh-eyes'
const CANCEL = `${BASE}/cancel`
const HOST = '3a000000-0000-4000-8000-000000000001'
const KEY = '4a000000-0000-4000-8000-000000000001'
const fresh = new Date(Date.now() - 30_000).toISOString()

function withWorker(db: FakeDb, projectId: string, over: { takes?: string[]; heartbeat?: string; owner?: string } = {}) {
  db.tables.work_hosts = [{ id: HOST, hostname: 'alienware', owner_user_id: over.owner ?? 'u1', api_key_id: KEY, last_heartbeat_at: over.heartbeat ?? fresh, revoked_at: null, takes: over.takes ?? ['fresh_eyes'] }]
  db.tables.work_lanes = [{ id: 'l1', host_id: HOST, project_id: projectId, name: 'glot', mode: 'fix', paused: false, drain: false, stop_at: null, concurrency: 1 }]
  db.tables.work_claims = db.tables.work_claims ?? []
}

describe('Run now', () => {
  const body = { url: 'https://glot.it/', goal: 'sign up and pick a language', sessions: 2, dryRun: true }

  it('starts another app on its own address with a plain goal, and offers no test account', async () => {
    const { db, app } = setup()
    db.tables.site_watches = [{ project_id: P, base_url: 'https://glot.it' }]
    const r = await app.call('GET', LIST, { pid: P }, undefined, { userId: OPERATOR, authMethod: 'jwt' })
    expect(r.body.data?.defaults).toEqual({ url: 'https://glot.it/', urlSource: 'site_watch', goal: 'sign up and start using the app', sessions: 3 })
    expect(r.body.data?.canUseTestAccount).toBe(false)
    expect(r.body.data?.runner).toEqual({ state: 'none', hostname: null, lastSeenAt: null })
    expect(JSON.stringify(r.body.data)).not.toContain('kensaur.us/mushi-mushi')
  })

  it("offers Mushi's own landing, goal and test accounts only to an operator on Mushi", async () => {
    const { app } = setup()
    state.members = new Set([P, SELF])
    const r = await app.call('GET', LIST, { pid: SELF }, undefined, { userId: OPERATOR, authMethod: 'jwt' })
    expect(r.body.data?.defaults).toMatchObject({ url: 'https://kensaur.us/mushi-mushi/', urlSource: 'mushi', goal: 'get my first bug explained' })
    expect(r.body.data?.canUseTestAccount).toBe(true)
    const other = await app.call('GET', LIST, { pid: SELF }, undefined, { userId: 'u1', authMethod: 'jwt' })
    expect(other.body.data?.canUseTestAccount).toBe(false)
  })

  it('says plainly when no computer can run it, and queues nothing', async () => {
    const { db, app } = setup()
    const r = await app.call('POST', LIST, { pid: P }, body, { authMethod: 'jwt' })
    expect(r.status).toBe(409)
    expect(r.body.error?.code).toBe('NO_WORKER')
    expect(r.body.error?.message).toContain('Pipeline → Workers')
    expect(db.tables.ux_runs).toHaveLength(0)
    withWorker(db, P, { takes: [] })
    const old = await app.call('POST', LIST, { pid: P }, body, { authMethod: 'jwt' })
    expect(old.body.error?.message).toContain('too old')
  })

  it('queues a run for an online worker that runs these tests', async () => {
    const { db, app } = setup()
    withWorker(db, P)
    const r = await app.call('POST', LIST, { pid: P }, body, { authMethod: 'jwt' })
    expect(r.status).toBe(201)
    const row = db.tables.ux_runs![0]!
    expect(row).toMatchObject({ kind: 'fresh_eyes', status: 'queued', start_url: 'https://glot.it/', goal: 'sign up and pick a language', sessions_requested: 2, dry_run: true, has_account: false, requested_by: 'u1' })
    expect(row.account_granted_by).toBeUndefined()
    expect(String(row.local_run_id)).toMatch(/^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/)
    expect(r.body.data).toMatchObject({ runId: row.local_run_id, status: 'queued', runner: { state: 'ready', hostname: 'alienware' } })
  })

  it('refuses viewers, bad input, and a third open run', async () => {
    const { db, app } = setup()
    withWorker(db, P)
    state.role = 'viewer'
    expect((await app.call('POST', LIST, { pid: P }, body, { authMethod: 'jwt' })).status).toBe(403)
    state.role = 'admin'
    expect((await app.call('POST', LIST, { pid: P }, { ...body, url: 'file:///etc/passwd' }, { authMethod: 'jwt' })).status).toBe(400)
    expect((await app.call('POST', LIST, { pid: P }, body, { authMethod: 'jwt' })).status).toBe(201)
    expect((await app.call('POST', LIST, { pid: P }, body, { authMethod: 'jwt' })).status).toBe(201)
    const third = await app.call('POST', LIST, { pid: P }, body, { authMethod: 'jwt' })
    expect(third.status).toBe(409)
    expect(third.body.error?.code).toBe('ALREADY_RUNNING')
  })

  it('grants a test account only to an operator session on Mushi, and stores no password', async () => {
    const { db, app } = setup()
    state.members = new Set([P, SELF])
    withWorker(db, SELF, { owner: OPERATOR })
    const acct = { url: 'https://kensaur.us/mushi-mushi/', goal: 'get my first bug explained', withAccount: true }
    expect((await app.call('POST', LIST, { pid: SELF }, acct, { userId: 'u1', authMethod: 'jwt' })).body.error?.code).toBe('TEST_ACCOUNT_UNAVAILABLE')
    expect((await app.call('POST', LIST, { pid: SELF }, acct, { userId: OPERATOR, authMethod: 'apiKey', isOrgScopedKey: true })).body.error?.code).toBe('TEST_ACCOUNT_UNAVAILABLE')
    withWorker(db, P, { owner: OPERATOR })
    expect((await app.call('POST', LIST, { pid: P }, acct, { userId: OPERATOR, authMethod: 'jwt' })).body.error?.code).toBe('TEST_ACCOUNT_UNAVAILABLE')
    withWorker(db, SELF, { owner: OPERATOR })
    const ok = await app.call('POST', LIST, { pid: SELF }, acct, { userId: OPERATOR, authMethod: 'jwt' })
    expect(ok.status).toBe(201)
    const row = db.tables.ux_runs!.find((r) => r.project_id === SELF)!
    expect(row).toMatchObject({ has_account: true, account_granted_by: OPERATOR })
    expect(Date.parse(String(row.account_grant_until)) - Date.now()).toBeLessThanOrEqual(2 * 3_600_000)
    expect(state.created).toHaveLength(0)
    expect(Object.keys(row).some((k) => /password/i.test(k))).toBe(false)
  })

  it('cancels a waiting run, never one a computer started', async () => {
    const { db, app } = setup()
    withWorker(db, P)
    const runId = String((await app.call('POST', LIST, { pid: P }, body, { authMethod: 'jwt' })).body.data?.runId)
    expect((await app.call('POST', CANCEL, { pid: P, runId }, undefined, { authMethod: 'jwt' })).status).toBe(200)
    expect(db.tables.ux_runs![0]).toMatchObject({ status: 'stopped', detail: 'Cancelled before a computer started it.' })
    expect((await app.call('POST', CANCEL, { pid: P, runId }, undefined, { authMethod: 'jwt' })).status).toBe(409)
  })

  it('stops a run nobody took within a day, with the reason', async () => {
    const { db, app } = setup()
    db.tables.ux_runs!.push({ id: 'old', project_id: P, local_run_id: '20261020-000000-aaaa', kind: 'fresh_eyes', status: 'queued', started_at: '2026-10-20T00:00:00.000Z' })
    const r = await app.call('GET', LIST, { pid: P }, undefined, { authMethod: 'jwt' })
    expect(r.status).toBe(200)
    expect(db.tables.ux_runs![0]).toMatchObject({ status: 'stopped', detail: 'No computer picked it up within a day, so it was not run.' })
  })
})

describe('a local worker syncs only the run it claimed', () => {
  const worker: Caller = { authMethod: 'apiKey', isOrgScopedKey: true, keyAllowedProjectIds: [P], apiKeyScopes: ['worker:run'], apiKeyId: KEY }
  function claimed(db: FakeDb, status = 'active') {
    withWorker(db, P)
    db.tables.ux_runs!.push({ id: 'ux1', project_id: P, local_run_id: RUN, kind: 'fresh_eyes', status: 'running', started_at: fresh })
    db.tables.work_claims!.push({ id: 'c1', host_id: HOST, kind: 'fresh_eyes', ux_run_id: 'ux1', status, lease_until: new Date(Date.now() + 600_000).toISOString() })
  }

  it('PUT, uploads and findings pass with the claim', async () => {
    const { db, app } = setup()
    claimed(db)
    expect((await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot(), worker)).status).toBe(200)
    expect((await app.call('POST', `${BASE}/uploads`, { pid: P, runId: RUN }, { names: ['s1-step00.png'] }, worker)).status).toBe(200)
    expect((await app.call('POST', `${BASE}/findings`, { pid: P, runId: RUN }, finding(), worker)).status).toBe(200)
  })

  it('are refused without an active claim, or for a run another worker holds', async () => {
    const { db, app } = setup()
    claimed(db, 'done')
    const r = await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot(), worker)
    expect(r.status).toBe(403)
    expect(r.body.error?.code).toBe('NO_WORK_CLAIM')
    db.tables.work_claims![0]!.status = 'active'
    expect((await app.call('PUT', BASE, { pid: P, runId: RUN }, snapshot(), { ...worker, apiKeyId: '5a000000-0000-4000-8000-000000000001' })).status).toBe(403)
    // Another run of the same app: no claim on it.
    expect((await app.call('POST', `${BASE}/findings`, { pid: P, runId: '20261027-230000-zz99' }, finding(), worker)).status).toBe(403)
  })
})
