/**
 * FILE: work-fresh-eyes-routes.test.ts
 * PURPOSE: A local worker runs a first-time user test the console queued
 *          (fresh-eyes "Run now", ADR 0053 amendment 2026-10-28), through the
 *          real handlers of api/routes/work.ts on an in-memory database:
 *            - the heartbeat stores what the daemon says it runs (`takes`)
 *              and wakes the lanes whose app has a test waiting;
 *            - any claiming lane of the app takes the test before its own
 *              work; an older daemon never gets one; two lanes never share
 *              one; a cancelled test is never started;
 *            - test accounts are minted at claim time only for the operator
 *              who queued it, on that operator's own computer, once;
 *            - the run row says why a test failed, stopped or ran out of lease;
 *            - `ran` ends only a test claim.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => null }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/quota.ts', () => ({ checkIngestQuota: async () => ({ allowed: true }) }))
vi.mock('../../supabase/functions/_shared/report-classification.ts', () => ({ queueReportClassification: async () => {} }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  callerProjectIds: async () => [],
  callerCanAccessProject: async () => ({ allowed: false, role: null }),
}))

let work: typeof import('../../supabase/functions/api/routes/work.ts')
beforeAll(async () => {
  work = await import('../../supabase/functions/api/routes/work.ts')
})

const NOW = new Date('2026-10-28T09:00:00Z')
const SELF = '0e000000-0000-4000-8000-00000000000e'
const GLOT = '1000000a-0000-4000-8000-000000000000'
const OPERATOR = '0f000000-0000-4000-8000-00000000000a'
const KEY = '9000000a-0000-4000-8000-000000000000'
const KEY2 = '9000000b-0000-4000-8000-000000000000'
const RUN = '20261028-085900-ab12'

type Res = { status: number; headers: Record<string, string>; body: { ok: boolean; data?: any; error?: { code: string; message: string } } }
type Handler = (c: unknown) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handler: Handler }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handler: h[h.length - 1] }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handler: h[h.length - 1] }) }
  put(path: string, ...h: Handler[]) { this.routes.push({ method: 'PUT', path, handler: h[h.length - 1] }) }
  patch(path: string, ...h: Handler[]) { this.routes.push({ method: 'PATCH', path, handler: h[h.length - 1] }) }
  delete(path: string, ...h: Handler[]) { this.routes.push({ method: 'DELETE', path, handler: h[h.length - 1] }) }
  async call(method: string, path: string, opts: { body?: unknown; params?: Record<string, string>; vars?: Record<string, unknown> } = {}): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: OPERATOR, authMethod: 'apiKey', apiKeyScopes: ['worker:run'], apiKeyId: KEY, ...opts.vars }
    const headers: Record<string, string> = {}
    const c = {
      req: { json: async () => opts.body ?? {}, param: (k: string) => opts.params?.[k], header: () => undefined, query: () => undefined },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      header: (k: string, v: string) => { headers[k] = v },
      json: (b: unknown, status = 200) => ({ body: b, status, headers }),
    }
    return (await route.handler(c)) as Res
  }
}

function setup(seed: Record<string, Array<Record<string, unknown>>> = {}, mint = vi.fn(async (_db: unknown, by: string) => ({ ok: true as const, account: { userId: crypto.randomUUID(), email: `fresh-eyes-${Math.random().toString(16).slice(2, 8)}@synthetic.kensaur.us`, password: 'Pw-not-logged-123456', name: 'Fresh Eyes', expiresAt: '2026-10-29T09:00:00Z', by } }))) {
  const db: FakeDb = makeFakeDb(
    { projects: [{ id: GLOT, name: 'glot.it' }, { id: SELF, name: 'Mushi' }], ux_runs: [], ...seed },
    {
      autoId: true,
      uniques: { work_queue: ['lane_id', 'report_id'], work_lanes: ['host_id', 'name'] },
      // One active claim per queued test, as uq_work_claims_active_ux_run.
      partialUniques: { work_claims: { keys: ['ux_run_id'], where: (r) => r.status === 'active' && r.ux_run_id != null } },
      rpc: () => null,
    },
  )
  const app = new FakeApp()
  work.registerWorkRoutes(app as never, {
    ...work.defaultWorkRouteDeps,
    getServiceClient: () => db as never,
    access: async () => ({ allowed: true, role: 'member' as never }),
    projectIds: async () => [GLOT],
    claimRateLimit: async () => ({ allowed: true }),
    logAudit: (async () => {}) as never,
    freshEyes: () => ({ mint: mint as never, isOperator: (id: string) => id === OPERATOR, selfProjectId: SELF }),
    now: () => NOW,
  })
  return { db, app, mint }
}

const hb = (lanes: Array<Record<string, unknown>>, takes?: string[], hostId = 'a'.repeat(64)) => ({
  host: { hostId, hostname: 'alienware', platform: 'wsl2', version: '0.33.0', ...(takes ? { takes } : {}) },
  status: {},
  lanes,
  claims: [],
})

const queued = (over: Record<string, unknown> = {}) => ({
  id: 'ux1',
  project_id: GLOT,
  local_run_id: RUN,
  kind: 'fresh_eyes',
  status: 'queued',
  start_url: 'https://glot.it/',
  goal: 'sign up and pick a language',
  sessions_requested: 2,
  success_text: null,
  dry_run: true,
  has_account: false,
  started_at: '2026-10-28T08:59:00Z',
  account_granted_by: null,
  account_grant_until: null,
  ...over,
})

async function register(app: FakeApp, specs: Array<{ name: string; mode?: string; projectId?: string }>, takes?: string[], vars: Record<string, unknown> = {}) {
  const res = await app.call('POST', '/v1/worker/heartbeat', {
    body: hb(specs.map((l) => ({ name: l.name, projectId: l.projectId ?? GLOT, status: {}, initial: { mode: l.mode ?? 'fix' } })), takes),
    vars,
  })
  expect(res.status).toBe(200)
  const ids: Record<string, string> = {}
  for (const l of res.body.data.lanes as Array<{ id: string; name: string }>) ids[l.name] = l.id
  return { ids, answer: res.body.data }
}

describe('heartbeat', () => {
  it('stores what the daemon runs and wakes the lanes whose app has a test waiting', async () => {
    const { db, app } = setup({ ux_runs: [queued()] })
    const { ids, answer } = await register(app, [{ name: 'glot' }, { name: 'mushi', projectId: SELF }], ['fresh_eyes', 'teleport'])
    expect(db.tables.work_hosts![0]!.takes).toEqual(['fresh_eyes'])
    expect(answer.wake).toEqual([ids.glot])
  })

  it('wakes nothing for a daemon that does not run these tests', async () => {
    const { db, app } = setup({ ux_runs: [queued()] })
    const { answer } = await register(app, [{ name: 'glot' }])
    expect(db.tables.work_hosts![0]!.takes).toEqual([])
    expect(answer.wake).toEqual([])
  })
})

describe('claim', () => {
  it('a fix lane takes the waiting test before its own work, and the run moves to running', async () => {
    const { db, app } = setup({ ux_runs: [queued()], reports: [{ id: 'r1', project_id: GLOT, status: 'classified', severity: 'high', created_at: '2026-10-28T08:00:00Z' }] })
    const { ids } = await register(app, [{ name: 'glot' }], ['fresh_eyes'])
    const res = await app.call('POST', '/v1/worker/claim', { body: { laneId: ids.glot } })
    expect(res.status).toBe(200)
    expect(res.body.data.claim).toMatchObject({ kind: 'fresh_eyes', laneId: ids.glot, model: null, freshEyes: { runId: RUN, url: 'https://glot.it/', goal: 'sign up and pick a language', sessions: 2, successText: null, dryRun: true, accounts: [] } })
    expect(db.tables.ux_runs![0]).toMatchObject({ status: 'running', claim_id: res.body.data.claim.id })
    expect(db.tables.work_claims![0]).toMatchObject({ kind: 'fresh_eyes', ux_run_id: 'ux1', report_id: null, status: 'active' })
    expect(res.headers['Cache-Control']).toBeUndefined()
  })

  it('an older daemon never gets one: it claims its own work', async () => {
    const { db, app } = setup({ ux_runs: [queued()] })
    const { ids } = await register(app, [{ name: 'glot' }])
    const res = await app.call('POST', '/v1/worker/claim', { body: { laneId: ids.glot } })
    expect(res.body.data.claim).toBeNull()
    expect(db.tables.ux_runs![0]!.status).toBe('queued')
  })

  it('two lanes never share one test, and a cancelled test is never started', async () => {
    const { db, app } = setup({ ux_runs: [queued()] })
    const { ids } = await register(app, [{ name: 'glot' }, { name: 'glot2', mode: 'audit' }], ['fresh_eyes'])
    const first = await app.call('POST', '/v1/worker/claim', { body: { laneId: ids.glot } })
    expect(first.body.data.claim.kind).toBe('fresh_eyes')
    const second = await app.call('POST', '/v1/worker/claim', { body: { laneId: ids.glot2 } })
    expect(second.body.data.claim?.kind).not.toBe('fresh_eyes')

    const s2 = setup({ ux_runs: [queued({ status: 'stopped' })] })
    const lanes2 = await register(s2.app, [{ name: 'glot' }], ['fresh_eyes'])
    const none = await s2.app.call('POST', '/v1/worker/claim', { body: { laneId: lanes2.ids.glot } })
    expect(none.body.data.claim).toBeNull()
    expect(s2.db.tables.work_claims ?? []).toHaveLength(0)
    expect(db.tables.work_claims!.filter((c) => c.kind === 'fresh_eyes')).toHaveLength(1)
  })

  it("mints one test account per visitor only on the operator's own computer, once, and never caches the answer", async () => {
    const grant = { project_id: SELF, dry_run: false, has_account: true, sessions_requested: 2, account_granted_by: OPERATOR, account_grant_until: '2026-10-28T10:00:00Z' }
    const { db, app, mint } = setup({ ux_runs: [queued(grant)] })
    const { ids } = await register(app, [{ name: 'mushi', projectId: SELF }], ['fresh_eyes'])
    const res = await app.call('POST', '/v1/worker/claim', { body: { laneId: ids.mushi } })
    expect(mint).toHaveBeenCalledTimes(2)
    expect(mint.mock.calls.every((c) => c[1] === OPERATOR)).toBe(true)
    expect(res.body.data.claim.freshEyes.accounts).toHaveLength(2)
    expect(res.headers['Cache-Control']).toBe('no-store')
    // The grant is spent and no password is stored anywhere.
    expect(db.tables.ux_runs![0]).toMatchObject({ account_granted_by: null, account_grant_until: null })
    expect(JSON.stringify(db.tables)).not.toContain('Pw-not-logged-123456')
  })

  it("runs without an account on someone else's computer, and says why", async () => {
    const grant = { project_id: SELF, dry_run: false, has_account: true, account_granted_by: OPERATOR, account_grant_until: '2026-10-28T10:00:00Z' }
    const { db, app, mint } = setup({ ux_runs: [queued(grant)] })
    const { ids } = await register(app, [{ name: 'mushi', projectId: SELF }], ['fresh_eyes'], { userId: 'someone-else', apiKeyId: KEY2 })
    const res = await app.call('POST', '/v1/worker/claim', { body: { laneId: ids.mushi }, vars: { userId: 'someone-else', apiKeyId: KEY2 } })
    expect(mint).not.toHaveBeenCalled()
    expect(res.body.data.claim.freshEyes.accounts).toEqual([])
    expect(db.tables.ux_runs![0]).toMatchObject({ has_account: false, account_granted_by: null })
    expect(String(db.tables.ux_runs![0]!.detail)).toContain('without a test account')
  })
})

describe('done', () => {
  async function claimed() {
    const s = setup({ ux_runs: [queued()] })
    const { ids } = await register(s.app, [{ name: 'glot' }], ['fresh_eyes'])
    const res = await s.app.call('POST', '/v1/worker/claim', { body: { laneId: ids.glot } })
    return { ...s, claimId: res.body.data.claim.id as string, laneId: ids.glot }
  }

  it('a failed test says why on its run', async () => {
    const { db, app, claimId } = await claimed()
    const r = await app.call('POST', '/v1/worker/claims/:id/done', { params: { id: claimId }, body: { outcome: 'failed', failureKind: 'infra', detail: 'mushi-ux could not start on this computer: ENOENT' } })
    expect(r.status).toBe(200)
    expect(r.body.data.requeued).toBe(false)
    expect(db.tables.ux_runs![0]).toMatchObject({ status: 'failed', detail: 'mushi-ux could not start on this computer: ENOENT' })
  })

  it('a test the CLI finished keeps what it synced', async () => {
    const { db, app, claimId } = await claimed()
    db.tables.ux_runs![0]!.status = 'done'
    await app.call('POST', '/v1/worker/claims/:id/done', { params: { id: claimId }, body: { outcome: 'ran', detail: '1 of 2 session(s) reached the goal' } })
    expect(db.tables.ux_runs![0]!.status).toBe('done')
    expect(db.tables.ux_runs![0]!.detail ?? null).toBeNull()
  })

  it('only a test claim ends as ran', async () => {
    const { app, db } = setup({ reports: [{ id: 'r1', project_id: GLOT, status: 'classified', severity: 'high', created_at: '2026-10-28T08:00:00Z' }] })
    const { ids } = await register(app, [{ name: 'glot' }], ['fresh_eyes'])
    const fix = await app.call('POST', '/v1/worker/claim', { body: { laneId: ids.glot } })
    expect(fix.body.data.claim.kind).toBe('fix')
    const r = await app.call('POST', '/v1/worker/claims/:id/done', { params: { id: fix.body.data.claim.id }, body: { outcome: 'ran' } })
    expect(r.status).toBe(400)
    expect(db.tables.work_claims![0]!.status).toBe('active')
  })

  it('a lease that runs out fails the run with a plain reason', async () => {
    const { db, app, laneId } = await claimed()
    db.tables.work_claims![0]!.lease_until = '2026-10-28T08:00:00Z'
    await app.call('POST', '/v1/worker/claim', { body: { laneId } })
    expect(db.tables.work_claims![0]).toMatchObject({ status: 'expired', outcome: 'lease_expired' })
    expect(db.tables.ux_runs![0]!.status).toBe('failed')
    expect(String(db.tables.ux_runs![0]!.detail)).toContain('stopped answering')
  })
})
