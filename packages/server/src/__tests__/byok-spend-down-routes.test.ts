/**
 * FILE: byok-spend-down-routes.test.ts
 * PURPOSE: GET /v1/admin/byok/spend-down and PATCH
 *          /v1/admin/byok/keys/:keyId/spend-down (ADR 0028), through the real
 *          handlers on an in-memory database: validation, who may change a
 *          shared key (ADR 0023), Cursor keys only, the expiry rule, the
 *          status the console and MCP read (scoreboard, stop-loss, limited to
 *          the apps the caller can open, degrading to null on a failed read),
 *          and Resume.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

type FakeDbOptions = NonNullable<Parameters<typeof makeFakeDb>[1]>

const state = vi.hoisted(() => ({
  db: null as unknown,
  authMethod: 'jwt' as 'jwt' | 'apiKey',
  orgRole: 'owner' as string | null,
  projectRole: 'owner' as string | null,
  /** projectId → the caller's role there (userCanAccessProject); absent = no access. */
  access: { '1000000a-0000-4000-8000-000000000000': 'owner' } as Record<string, string>,
  userId: 'u1',
}))

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = () => {}
  logger.child = () => logger
  return logger
})

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => state.db }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/entitlements.ts', () => ({
  requireFeature: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => unknown }, err: { message?: string } | null) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: err?.message ?? 'db' } }, 500),
  resolveOwnedProject: async () => ({
    project: { id: P1, name: 'app', organization_id: ORG, organization_role: state.projectRole },
  }),
  userCanAccessProject: async (_db: unknown, _user: string, projectId: string) => ({
    allowed: !!state.access[projectId],
    role: state.access[projectId] ?? null,
  }),
}))

let routes: typeof import('../../supabase/functions/api/routes/byok-spend-down.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/byok-spend-down.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const SHARED = '2000000a-0000-4000-8000-000000000000'
const OWN = '2000000b-0000-4000-8000-000000000000'
const OPENAI = '2000000c-0000-4000-8000-000000000000'

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handlers: h }) }
  patch(path: string, ...h: Handler[]) { this.routes.push({ method: 'PATCH', path, handlers: h }) }
  post(path: string, ...h: Handler[]) { this.routes.push({ method: 'POST', path, handlers: h }) }
  async call(method: string, path: string, params: Record<string, string>, body?: unknown): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: state.userId, authMethod: state.authMethod, projectId: P1 }
    const c = {
      req: { json: async () => body ?? {}, param: (k: string) => params[k], header: () => undefined, query: () => undefined },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handlers[route.handlers.length - 1](c)) as Res
  }
}

function setup(options: Partial<FakeDbOptions> = {}): { db: FakeDb; app: FakeApp } {
  const db = makeFakeDb(
    {
      projects: [{ id: P1, name: 'tsumagoi', organization_id: ORG }],
      project_settings: [{ project_id: P1, autofix_enabled: true }],
      project_repos: [{ project_id: P1 }],
      organization_members: [{ organization_id: ORG, user_id: 'u1', role: state.orgRole }],
      byok_keys: [
        { id: SHARED, provider_slug: 'cursor', project_id: null, organization_id: ORG, status: 'active', test_status: 'ok', priority: 100, label: 'ayako', credits_expire_at: null, spend_down_enabled: false, spend_down_model: null, spend_down_daily_limit: 10, spend_down_window_days: 14 },
        { id: OWN, provider_slug: 'cursor', project_id: P1, organization_id: null, status: 'active', test_status: 'ok', priority: 100, label: 'hirose', credits_expire_at: null, spend_down_enabled: false, spend_down_model: null, spend_down_daily_limit: 10, spend_down_window_days: 14 },
        { id: OPENAI, provider_slug: 'openai', project_id: P1, organization_id: null, status: 'active' },
      ],
      fix_dispatch_jobs: [],
    },
    { autoId: true, ...options },
  )
  state.db = db
  const app = new FakeApp()
  routes.registerByokSpendDownRoutes(app as never)
  return { db, app }
}

const PATCH = '/v1/admin/byok/keys/:keyId/spend-down'
const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)

describe('PATCH spend-down', () => {
  it('turns it on for a shared key when an org owner sets a date, model and limit', async () => {
    state.authMethod = 'jwt'; state.orgRole = 'owner'; state.projectRole = 'owner'
    const { db, app } = setup()
    const res = await app.call('PATCH', PATCH, { keyId: SHARED }, {
      enabled: true, creditsExpireAt: future, model: 'grok-4.7?reasoning_effort=xhigh&context=500k', dailyLimit: 20,
    })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ enabled: true, dailyLimit: 20, model: 'grok-4.7?reasoning_effort=xhigh&context=500k' })
    const row = db.table('byok_keys').find((k: Record<string, unknown>) => k.id === SHARED) as Record<string, unknown>
    expect(row.spend_down_enabled).toBe(true)
    expect(String(row.credits_expire_at)).toContain(future)
  })

  it('refuses to turn it on without a credit expiry date', async () => {
    state.authMethod = 'jwt'; state.orgRole = 'owner'
    const { app } = setup()
    const res = await app.call('PATCH', PATCH, { keyId: SHARED }, { enabled: true })
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('EXPIRY_REQUIRED')
  })

  it('a shared key needs an org owner or admin in the console (ADR 0023)', async () => {
    state.authMethod = 'jwt'; state.orgRole = 'member'
    let { app } = setup()
    expect((await app.call('PATCH', PATCH, { keyId: SHARED }, { dailyLimit: 5 })).body.error?.code).toBe('SHARED_KEY_ADMIN_ONLY')
    state.authMethod = 'apiKey'; state.orgRole = 'owner'
    ;({ app } = setup())
    expect((await app.call('PATCH', PATCH, { keyId: SHARED }, { dailyLimit: 5 })).status).toBe(403)
  })

  it("an app's own key: its owner may, a viewer may not", async () => {
    state.authMethod = 'apiKey'; state.projectRole = 'owner'
    let { app } = setup()
    expect((await app.call('PATCH', PATCH, { keyId: OWN }, { dailyLimit: 5 })).status).toBe(200)
    state.authMethod = 'jwt'; state.projectRole = 'viewer'
    ;({ app } = setup())
    expect((await app.call('PATCH', PATCH, { keyId: OWN }, { dailyLimit: 5 })).body.error?.code).toBe('FORBIDDEN')
  })

  it('validates every field and refuses non-Cursor keys', async () => {
    state.authMethod = 'jwt'; state.orgRole = 'owner'; state.projectRole = 'owner'
    const { app } = setup()
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ enabled: 'yes' }, 'VALIDATION_ERROR'],
      [{ creditsExpireAt: '2020-01-01' }, 'INVALID_EXPIRY'],
      [{ model: 'grok 4.7' }, 'INVALID_CURSOR_MODEL'],
      [{ dailyLimit: 0 }, 'VALIDATION_ERROR'],
      [{ windowDays: 91 }, 'VALIDATION_ERROR'],
      [{}, 'VALIDATION_ERROR'],
    ]
    for (const [body, code] of cases) {
      expect((await app.call('PATCH', PATCH, { keyId: SHARED }, body)).body.error?.code, JSON.stringify(body)).toBe(code)
    }
    expect((await app.call('PATCH', PATCH, { keyId: OPENAI }, { dailyLimit: 3 })).body.error?.code).toBe('NOT_CURSOR_KEY')
    expect((await app.call('PATCH', PATCH, { keyId: 'nope' }, { dailyLimit: 3 })).body.error?.code).toBe('INVALID_KEY_ID')
  })
})

describe('GET spend-down', () => {
  it("lists the app's Cursor keys with their window and the apps each pays for", async () => {
    state.authMethod = 'jwt'
    const { db, app } = setup()
    const shared = db.table('byok_keys').find((k: Record<string, unknown>) => k.id === SHARED) as Record<string, unknown>
    Object.assign(shared, { spend_down_enabled: true, credits_expire_at: new Date(Date.now() + 3 * 86_400_000).toISOString() })
    const res = await app.call('GET', '/v1/admin/byok/spend-down', {})
    expect(res.status).toBe(200)
    const keys = res.body.data?.keys as Array<Record<string, unknown>>
    expect(keys.map((k) => k.id).sort()).toEqual([SHARED, OWN].sort())
    const s = keys.find((k) => k.id === SHARED)!
    // tsumagoi has its own Cursor key, so the shared key pays for nothing here (ADR 0023).
    expect(s).toMatchObject({ scope: 'organization', state: 'active', dispatchedToday: 0, remainingToday: 10, projects: [] })
    const own = keys.find((k) => k.id === OWN)!
    expect(own).toMatchObject({ scope: 'project', state: 'off', projects: [{ id: P1, name: 'tsumagoi' }] })
    expect(own.scoreboard).toMatchObject({ days: 7, rows: [], totals: { runs: 0, mergeableYield: null } })
  })

  it("returns each key's last-7-days scoreboard and each app's stop-loss state", async () => {
    state.authMethod = 'jwt'
    const { db, app } = setup()
    const at = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString()
    const meta = { source: 'spend_down', spend_down_key_id: OWN, model_override: 'grok-4.7' }
    // 10 PRs reviewed: 1 merge (merged), 2 hold, 7 fix_first, plus 2 no-PR runs, 1 Cursor error,
    // and one 8 days old that the scoreboard leaves out (the stop-loss, 14 days, still reads it).
    for (let i = 0; i < 14; i++) {
      const id = `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`
      const old = i === 13
      db.table('fix_dispatch_jobs').push({
        id: `j${i}`, project_id: P1, report_id: `r${i}`, status: 'completed', fix_attempt_id: id,
        created_at: old ? at(8 * 24 * 60) : at(i + 1), dispatch_metadata: meta,
      })
      const noPr = i === 10 || i === 11
      const apiError = i === 12
      db.table('fix_attempts').push({
        id, project_id: P1, report_id: `r${i}`, agent: 'cursor_cloud',
        status: noPr || apiError ? 'failed' : 'completed',
        pr_url: noPr || apiError ? null : `https://github.com/a/b/pull/${i + 1}`,
        failure_category: noPr ? 'needs_human' : apiError ? 'cursor_api_error' : null,
        merged_at: i === 0 ? at(0) : null,
      })
      if (i < 10 || old) {
        db.table('fix_reviews').push({
          fix_attempt_id: id, verdict: i === 0 ? 'merge' : i < 3 ? 'hold' : 'fix_first',
          reviewed_at: at(i), cost_usd: '0.5000',
        })
      }
    }
    const res = await app.call('GET', '/v1/admin/byok/spend-down', {})
    const own = (res.body.data?.keys as Array<Record<string, unknown>>).find((k) => k.id === OWN)!
    expect((own.scoreboard as { totals: unknown }).totals).toMatchObject({
      runs: 13, prsOpened: 10, noPrVerdicts: 2, otherFailures: 1, reviewed: 10,
      verdicts: { merge: 1, fix_first: 7, hold: 2 }, merged: 1, latestReviewCostUsd: 5,
      mergeYield: 1 / 13, mergeableYield: 1 / 13,
    })
    expect((own.scoreboard as { rows: Array<Record<string, unknown>> }).rows[0]).toMatchObject({ keyId: OWN, projectId: P1, model: 'grok-4.7' })
    const [project] = own.projects as Array<{ id: string; stopLoss: Record<string, unknown> }>
    expect(project.id).toBe(P1)
    // 11 reviews (the 8-day-old one counts): under 20, so cold start.
    expect(project.stopLoss).toMatchObject({ paused: false, reviewed: 11, mergeVerdicts: 1, mergeUpper: null })
    expect(own).toMatchObject({ otherApps: 0, projectsNote: null, stopLossNote: null, scoreboardNote: null })
    expect(own.projects).toMatchObject([{ id: P1, canResume: true }])
  })

  it('a member sees the pause but cannot Resume; a failed app-name read is a note, not a silent empty list', async () => {
    state.authMethod = 'jwt'
    state.access = { [P1]: 'member' }
    let { app } = setup()
    let own = ((await app.call('GET', '/v1/admin/byok/spend-down', {})).body.data?.keys as Array<Record<string, unknown>>).find((k) => k.id === OWN)!
    expect(own.projects).toMatchObject([{ id: P1, canResume: false }])

    state.access = { [P1]: 'owner' }
    // `projects` reads, in order: the shared key's served apps, OWN's served
    // apps, then OWN's app names; fail only the names.
    let reads = 0
    ;({ app } = setup({ failRead: (t) => (t === 'projects' && ++reads === 3 ? 'boom' : null) }))
    const res = await app.call('GET', '/v1/admin/byok/spend-down', {})
    expect(res.status).toBe(200)
    own = (res.body.data?.keys as Array<Record<string, unknown>>).find((k) => k.id === OWN)!
    expect(own).toMatchObject({ projects: [], projectsNote: 'The apps this key pays for could not be read just now.' })
  })

  it('shows a paused app with its reason', async () => {
    state.authMethod = 'jwt'
    const { db, app } = setup()
    for (let i = 0; i < 20; i++) {
      const id = `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`
      const created = new Date(Date.now() - (i + 1) * 60_000).toISOString()
      db.table('fix_dispatch_jobs').push({ id: `p${i}`, project_id: P1, report_id: `r${i}`, status: 'completed', fix_attempt_id: id, created_at: created, dispatch_metadata: { source: 'spend_down', spend_down_key_id: OWN } })
      db.table('fix_attempts').push({ id, project_id: P1, status: 'completed', pr_url: `https://github.com/a/b/pull/${i}` })
      db.table('fix_reviews').push({ fix_attempt_id: id, verdict: i === 0 ? 'merge' : 'fix_first', reviewed_at: created })
    }
    const res = await app.call('GET', '/v1/admin/byok/spend-down', {})
    const own = (res.body.data?.keys as Array<Record<string, unknown>>).find((k) => k.id === OWN)!
    expect((own.projects as Array<{ stopLoss: Record<string, unknown> }>)[0].stopLoss).toMatchObject({
      paused: true,
      reason: 'Paused: 1 of the last 20 reviewed fixes were mergeable (5%)',
    })
  })
})

describe('GET spend-down: two organization Cursor keys', () => {
  const SUZU = '2000000e-0000-4000-8000-000000000000'
  const OUTRANKED = 'ayako pays for these apps first (priority 10); this key takes over when ayako runs out or is removed'

  function twoOrgKeys(ayako: { status: string; test_status: string }) {
    const { db, app } = setup()
    db.table('byok_keys').splice(db.table('byok_keys').findIndex((k) => k.id === OWN), 1)
    const expiry = new Date(Date.now() + 3 * 86_400_000).toISOString()
    Object.assign(db.table('byok_keys').find((k) => k.id === SHARED)!, {
      label: 'ayako',
      priority: 10,
      status: ayako.status,
      test_status: ayako.test_status,
      spend_down_enabled: true,
      credits_expire_at: expiry,
    })
    db.table('byok_keys').push({
      id: SUZU,
      provider_slug: 'cursor',
      project_id: null,
      organization_id: ORG,
      status: 'active',
      test_status: 'ok',
      priority: 50,
      label: 'suzu.haruka',
      credits_expire_at: expiry,
      spend_down_enabled: true,
      spend_down_model: null,
      spend_down_daily_limit: 10,
      spend_down_window_days: 14,
    })
    return { db, app }
  }

  it('says which org key pays first when this one is only outranked', async () => {
    state.authMethod = 'jwt'
    state.access = { [P1]: 'owner' }
    const { app } = twoOrgKeys({ status: 'active', test_status: 'ok' })
    const res = await app.call('GET', '/v1/admin/byok/spend-down', {})
    expect(res.status).toBe(200)
    const keys = res.body.data?.keys as Array<Record<string, unknown>>
    const ayako = keys.find((k) => k.id === SHARED)!
    const suzu = keys.find((k) => k.id === SUZU)!
    expect(ayako.projects).toMatchObject([{ id: P1 }])
    expect(ayako.idleNote).toBeNull()
    expect(suzu.projects).toEqual([])
    expect(suzu.idleNote).toBe(OUTRANKED)
  })

  it('a quota-exhausted higher-priority key hands the apps to the next one', async () => {
    state.authMethod = 'jwt'
    state.access = { [P1]: 'owner' }
    const { app } = twoOrgKeys({ status: 'quota_exhausted', test_status: 'error_quota' })
    const res = await app.call('GET', '/v1/admin/byok/spend-down', {})
    const keys = res.body.data?.keys as Array<Record<string, unknown>>
    const ayako = keys.find((k) => k.id === SHARED)!
    const suzu = keys.find((k) => k.id === SUZU)!
    expect(ayako).toMatchObject({ state: 'key_unusable', projects: [], idleNote: null })
    expect(suzu.projects).toMatchObject([{ id: P1 }])
    expect(suzu.idleNote).toBeNull()
  })
})

describe('GET spend-down: who sees what (a shared key pays for apps the caller cannot open)', () => {
  function sharedSetup() {
    const { db, app } = setup()
    db.table('byok_keys').splice(db.table('byok_keys').findIndex((k) => k.id === OWN), 1)
    Object.assign(db.table('byok_keys').find((k) => k.id === SHARED)!, {
      spend_down_enabled: true,
      credits_expire_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      spend_down_last_summary: {
        projects: [
          { projectId: P1, dispatched: 1 },
          { projectId: P2, dispatched: 0, stopped: 'No open report to fix' },
        ],
      },
    })
    db.table('projects').push({ id: P2, name: 'secret-app', organization_id: ORG })
    db.table('project_settings').push({ project_id: P2, autofix_enabled: true })
    db.table('project_repos').push({ project_id: P2 })
    const meta = { source: 'spend_down', spend_down_key_id: SHARED, model_override: 'grok' }
    const created = new Date(Date.now() - 60_000).toISOString()
    for (const [pid, n] of [[P1, 2], [P2, 3]] as const) {
      for (let i = 0; i < n; i++) {
        db.table('fix_dispatch_jobs').push({ id: `${pid}-${i}`, project_id: pid, report_id: `r${i}`, status: 'failed', fix_attempt_id: null, created_at: created, dispatch_metadata: meta })
      }
    }
    return { db, app }
  }

  it('a console user sees only the apps they can open; totals stay key-wide', async () => {
    state.authMethod = 'jwt'
    state.access = { [P1]: 'member' }
    const { app } = sharedSetup()
    const res = await app.call('GET', '/v1/admin/byok/spend-down', {})
    const shared = (res.body.data?.keys as Array<Record<string, unknown>>).find((k) => k.id === SHARED)!
    expect((shared.projects as Array<{ id: string }>).map((p) => p.id)).toEqual([P1])
    expect(shared.otherApps).toBe(1)
    const board = shared.scoreboard as { totals: { runs: number }; rows: Array<{ projectId: string }> }
    expect(board.totals.runs).toBe(5)
    expect(board.rows.map((r) => r.projectId)).toEqual([P1])
    expect((shared.lastSummary as { projects: Array<{ projectId: string }> }).projects.map((p) => p.projectId)).toEqual([P1])
    expect(JSON.stringify(res.body)).not.toContain('secret-app')
    state.access = { [P1]: 'owner' }
  })

  it('an API key sees its own app only, even when its user could open more', async () => {
    state.authMethod = 'apiKey'
    state.access = { [P1]: 'owner', [P2]: 'owner' }
    const { app } = sharedSetup()
    const res = await app.call('GET', '/v1/admin/byok/spend-down', {})
    const shared = (res.body.data?.keys as Array<Record<string, unknown>>).find((k) => k.id === SHARED)!
    expect((shared.projects as Array<{ id: string }>).map((p) => p.id)).toEqual([P1])
    expect((shared.scoreboard as { rows: Array<{ projectId: string }> }).rows.map((r) => r.projectId)).toEqual([P1])
    state.access = { [P1]: 'owner' }
  })
})

describe('GET spend-down degrades instead of failing', () => {
  it('a failed yield or scoreboard read gives nulls with a note and keeps the rest', async () => {
    state.authMethod = 'jwt'
    const { db, app } = setup({ failRead: (t) => (t === 'fix_reviews' ? 'boom' : null) })
    const aid = '00000000-0000-4000-8000-000000000999'
    db.table('fix_dispatch_jobs').push({ id: 'jx', project_id: P1, report_id: 'rx', status: 'completed', fix_attempt_id: aid, created_at: new Date(Date.now() - 60_000).toISOString(), dispatch_metadata: { source: 'spend_down', spend_down_key_id: OWN } })
    db.table('fix_attempts').push({ id: aid, project_id: P1, status: 'completed', pr_url: 'https://github.com/a/b/pull/9' })
    const res = await app.call('GET', '/v1/admin/byok/spend-down', {})
    expect(res.status).toBe(200)
    const own = (res.body.data?.keys as Array<Record<string, unknown>>).find((k) => k.id === OWN)!
    expect(own).toMatchObject({
      dispatchedToday: 1,
      projects: [{ id: P1, stopLoss: null }],
      scoreboard: null,
      scoreboardNote: 'The last 7 days could not be read just now.',
      stopLossNote: 'The yield of some apps could not be read just now.',
    })
  })
})

describe('POST spend-down resume', () => {
  const RESUME = '/v1/admin/byok/spend-down/projects/:projectId/resume'
  it("an app's owner or admin stamps the reset time", async () => {
    state.authMethod = 'jwt'
    state.access = { [P1]: 'admin' }
    const { db, app } = setup()
    const res = await app.call('POST', RESUME, { projectId: P1 })
    expect(res.status).toBe(200)
    const row = db.table('project_settings').find((s) => s.project_id === P1)!
    expect(row.spend_down_stop_loss_reset_at).toBe((res.body.data as { resetAt: string }).resetAt)
    state.access = { [P1]: 'owner' }
  })

  it('a member or viewer may not; an app the caller cannot open is not found; ids are checked', async () => {
    state.authMethod = 'jwt'
    state.access = { [P1]: 'viewer' }
    let { app } = setup()
    expect((await app.call('POST', RESUME, { projectId: P1 })).body.error?.code).toBe('FORBIDDEN')
    state.access = {}
    ;({ app } = setup())
    expect((await app.call('POST', RESUME, { projectId: P1 })).status).toBe(404)
    expect((await app.call('POST', RESUME, { projectId: 'nope' })).body.error?.code).toBe('INVALID_PROJECT_ID')
    state.access = { [P1]: 'owner' }
  })
})

describe('GET spend-down with a universal key (ADR 0031)', () => {
  // The key's owner owns two organizations: ORG (this app, tsumagoi) and
  // ORG_Y (another app). Others looking from ORG must never see ORG_Y's app.
  const OWNER = 'aaaaaaaa-0000-4000-8000-00000000000a'
  const VIEWER = 'bbbbbbbb-0000-4000-8000-00000000000b'
  const ORG_Y = '0000000b-0000-4000-8000-000000000000'
  const P_Y = '1000000b-0000-4000-8000-000000000000'
  const UNIVERSAL = '2000000d-0000-4000-8000-000000000000'

  function setupUniversal(): FakeApp {
    const db = makeFakeDb(
      {
        projects: [
          { id: P1, name: 'tsumagoi', organization_id: ORG },
          { id: P_Y, name: 'secret-other-org-app', organization_id: ORG_Y },
        ],
        project_settings: [
          { project_id: P1, autofix_enabled: true },
          { project_id: P_Y, autofix_enabled: true },
        ],
        project_repos: [{ project_id: P1 }, { project_id: P_Y }],
        organization_members: [
          { organization_id: ORG, user_id: OWNER, role: 'owner' },
          { organization_id: ORG_Y, user_id: OWNER, role: 'owner' },
          { organization_id: ORG, user_id: VIEWER, role: 'viewer' },
        ],
        byok_keys: [
          {
            id: UNIVERSAL, provider_slug: 'cursor', project_id: null, organization_id: null, owner_user_id: OWNER,
            status: 'active', test_status: 'ok', priority: 100, label: 'all apps', key_hint: '…9999',
            credits_expire_at: null, spend_down_enabled: false, spend_down_model: null, spend_down_daily_limit: 10, spend_down_window_days: 14,
            spend_down_last_run_at: '2026-10-21T00:00:00Z',
            spend_down_last_summary: { keyId: UNIVERSAL, dispatched: 3, projects: [{ projectId: P1, dispatched: 1 }, { projectId: P_Y, dispatched: 2 }] },
          },
        ],
        // Today: one spend-down dispatch in this organization, two in the other.
        fix_dispatch_jobs: [
          { id: 'j1', project_id: P1, dispatch_metadata: { spend_down_key_id: UNIVERSAL }, created_at: new Date().toISOString() },
          { id: 'j2', project_id: P_Y, dispatch_metadata: { spend_down_key_id: UNIVERSAL }, created_at: new Date().toISOString() },
          { id: 'j3', project_id: P_Y, dispatch_metadata: { spend_down_key_id: UNIVERSAL }, created_at: new Date().toISOString() },
        ],
      },
      { autoId: true },
    )
    state.db = db
    const app = new FakeApp()
    routes.registerByokSpendDownRoutes(app as never)
    return app
  }

  async function universalKey() {
    const res = await setupUniversal().call('GET', '/v1/admin/byok/spend-down', {})
    expect(res.status).toBe(200)
    const key = (res.body.data?.keys as Array<Record<string, unknown>>).find((k) => k.id === UNIVERSAL)!
    return { key, raw: JSON.stringify(res.body) }
  }

  it("a viewer in this organization does not see the other organization's app", async () => {
    state.authMethod = 'jwt'; state.userId = VIEWER
    // Even with access to the other app (#538's per-app scoping alone would
    // show it), someone else's universal key shows this organization only.
    state.access = { [P1]: 'viewer', [P_Y]: 'member' }
    const { key, raw } = await universalKey()
    expect(key).toMatchObject({ scope: 'universal', ownedByMe: false, projects: [{ id: P1, name: 'tsumagoi' }] })
    expect(key.lastSummary).toMatchObject({ dispatched: 1, projects: [{ projectId: P1, dispatched: 1 }] })
    // Only this organization's share of today's dispatches, no key-wide remainder.
    expect(key).toMatchObject({ dispatchedToday: 1, remainingToday: null })
    expect(key.lastSummary).toMatchObject({ dispatchedToday: null, remainingToday: null })
    expect(raw).not.toContain(P_Y)
    expect(raw).not.toContain('secret-other-org-app')
  })

  it("an mcp:read API key from this organization does not see it either", async () => {
    // An API key's userId is its project's owner, but an API key never owns a key.
    state.authMethod = 'apiKey'; state.userId = OWNER
    state.access = { [P1]: 'owner', [P_Y]: 'owner' }
    const { key, raw } = await universalKey()
    expect(key).toMatchObject({ ownedByMe: false, projects: [{ id: P1, name: 'tsumagoi' }], dispatchedToday: 1, remainingToday: null })
    expect(raw).not.toContain(P_Y)
    expect(raw).not.toContain('secret-other-org-app')
  })

  it("the key's owner in the console sees every app it pays for", async () => {
    state.authMethod = 'jwt'; state.userId = OWNER
    state.access = { [P1]: 'owner', [P_Y]: 'owner' }
    const { key } = await universalKey()
    expect(key.ownedByMe).toBe(true)
    expect(key.dispatchedToday).toBe(3)
    expect((key.projects as Array<{ id: string }>).map((p) => p.id).sort()).toEqual([P1, P_Y].sort())
    expect((key.lastSummary as { projects: unknown[] }).projects).toHaveLength(2)
    state.userId = 'u1'
    state.access = { [P1]: 'owner' }
  })
})
