/**
 * FILE: byok-spend-down-routes.test.ts
 * PURPOSE: GET /v1/admin/byok/spend-down and PATCH
 *          /v1/admin/byok/keys/:keyId/spend-down (ADR 0028), through the real
 *          handlers on an in-memory database: validation, who may change a
 *          shared key (ADR 0023), Cursor keys only, the expiry rule, and the
 *          status the console and MCP read.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const state = vi.hoisted(() => ({
  db: null as unknown,
  authMethod: 'jwt' as 'jwt' | 'apiKey',
  orgRole: 'owner' as string | null,
  projectRole: 'owner' as string | null,
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
}))

let routes: typeof import('../../supabase/functions/api/routes/byok-spend-down.ts')
beforeAll(async () => {
  routes = await import('../../supabase/functions/api/routes/byok-spend-down.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const SHARED = '2000000a-0000-4000-8000-000000000000'
const OWN = '2000000b-0000-4000-8000-000000000000'
const OPENAI = '2000000c-0000-4000-8000-000000000000'

type Res = { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }
type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown

class FakeApp {
  routes: Array<{ method: string; path: string; handlers: Handler[] }> = []
  get(path: string, ...h: Handler[]) { this.routes.push({ method: 'GET', path, handlers: h }) }
  patch(path: string, ...h: Handler[]) { this.routes.push({ method: 'PATCH', path, handlers: h }) }
  async call(method: string, path: string, params: Record<string, string>, body?: unknown): Promise<Res> {
    const route = this.routes.find((r) => r.method === method && r.path === path)
    if (!route) throw new Error(`no route ${method} ${path}`)
    const vars: Record<string, unknown> = { userId: 'u1', authMethod: state.authMethod, projectId: P1 }
    const c = {
      req: { json: async () => body ?? {}, param: (k: string) => params[k], header: () => undefined, query: () => undefined },
      get: (k: string) => vars[k],
      set: (k: string, v: unknown) => { vars[k] = v },
      json: (b: unknown, status = 200) => ({ body: b, status }),
    }
    return (await route.handlers[route.handlers.length - 1](c)) as Res
  }
}

function setup(): { db: FakeDb; app: FakeApp } {
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
    { autoId: true },
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
    // and one 8 days old that the scoreboard leaves out (the stop-loss still reads it).
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
      verdicts: { merge: 1, fix_first: 7, hold: 2 }, merged: 1, reviewCostUsd: 5,
      mergeYield: 1 / 13, mergeableYield: 1 / 13,
    })
    expect((own.scoreboard as { rows: Array<Record<string, unknown>> }).rows[0]).toMatchObject({ keyId: OWN, projectId: P1, model: 'grok-4.7' })
    const [project] = own.projects as Array<{ id: string; stopLoss: Record<string, unknown> }>
    expect(project.id).toBe(P1)
    // 11 reviews (the old one counts here): 1 merge = 9%.
    expect(project.stopLoss).toMatchObject({ paused: true, reviewed: 11, mergeVerdicts: 1 })
    expect(project.stopLoss.reason).toBe('Paused: 1 of the last 11 reviewed fixes were mergeable (9%)')
  })
})
