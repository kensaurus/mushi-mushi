/**
 * Plan 020 §8 cross-app funnel rollup: one definition per organization, run
 * per app over product_funnel. No definition is "not set up", an app with
 * product events off is "off", nothing entered is "no_events" — never 0%.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let funnel: typeof import('../../supabase/functions/api/routes/portfolio-funnel.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  funnel = await import('../../supabase/functions/api/routes/portfolio-funnel.ts')
})

const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const P3 = '1000000c-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-02T12:00:00Z')

type Handler = (c: any, next?: () => Promise<void>) => Promise<unknown> | unknown
class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  private add(method: string, path: string, handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method, keys, handlers, pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  get(p: string, ...h: Handler[]) { this.add('GET', p, h) }
  put(p: string, ...h: Handler[]) { this.add('PUT', p, h) }
  async call(method: string, url: string, opts: { body?: unknown; vars?: Record<string, unknown> } = {}): Promise<{ status: number; body: any }> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (r.method !== method || !m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const vars: Record<string, unknown> = { userId: 'owner', authMethod: 'jwt', ...opts.vars }
      const c = {
        req: { json: async () => opts.body, param: (k: string) => params[k], query: () => undefined, header: () => undefined },
        get: (k: string) => vars[k], set: (k: string, v: unknown) => { vars[k] = v }, header: () => {},
        json: (body: unknown, status = 200) => ({ body, status }),
      }
      let result: unknown
      const go = async (i: number): Promise<void> => {
        if (i === r.handlers.length - 1) { result = await r.handlers[i](c); return }
        const short = await r.handlers[i](c, () => go(i + 1))
        if (result === undefined && short !== undefined) result = short
      }
      await go(0)
      return result as { status: number; body: any }
    }
    throw new Error(`no route ${method} ${url}`)
  }
}

function setup(extra: Record<string, unknown[]> = {}, rpc?: (fn: string, args: Record<string, unknown>) => unknown) {
  const db = makeFakeDb({
    organizations: [{ id: ORG, name: 'A' }],
    organization_members: [{ organization_id: ORG, user_id: 'owner', role: 'owner' }, { organization_id: ORG, user_id: 'member', role: 'member' }],
    projects: [
      { id: P1, name: 'glot.it', owner_id: 'owner', organization_id: ORG },
      { id: P2, name: 'yen-yen', owner_id: 'owner', organization_id: ORG },
      { id: P3, name: 'hhtp', owner_id: 'owner', organization_id: ORG },
    ],
    project_members: [],
    project_settings: [{ project_id: P3, product_events_enabled: false }],
    ...extra,
  } as never, { autoId: true, rpc })
  const app = new FakeApp()
  funnel.registerPortfolioFunnelRoutes(app as never, { getServiceClient: () => db as never, adminOrApiKeyRead: (async (_c: unknown, next: () => Promise<void>) => next()) as never, jwtAuth: (async (_c: unknown, next: () => Promise<void>) => next()) as never, now: () => NOW })
  return { db, app }
}

describe('cross-app funnel', () => {
  it('says not set up when the organization has no funnel, instead of zeros', async () => {
    const { app } = setup()
    const r = await app.call('GET', `/v1/admin/orgs/${ORG}/funnel`)
    expect(r.body.data).toEqual({ state: 'not_set_up', definition: null, rows: [] })
  })

  it('runs one definition per app and labels apps with events off or no events', async () => {
    const calls: Array<Record<string, unknown>> = []
    const { app } = setup(
      { org_funnel_definitions: [{ organization_id: ORG, steps: ['signup_completed', 'first_lesson', 'day7_return'], conversion_window: '7d', lookback_days: 30, updated_at: '2026-10-01T00:00:00Z' }] },
      (fn, args) => {
        calls.push({ fn, ...args })
        if (args.p_project_id === P1) return { steps: [{ name: 'signup_completed', entered: 200, converted: 200, pct: 100 }, { name: 'first_lesson', entered: 200, converted: 120, pct: 60 }, { name: 'day7_return', entered: 120, converted: 50, pct: 25 }] }
        return { steps: [{ name: 'signup_completed', entered: 0, converted: 0, pct: 0 }] }
      },
    )
    const r = await app.call('GET', `/v1/admin/orgs/${ORG}/funnel`)
    expect(r.status).toBe(200)
    const byId = Object.fromEntries(r.body.data.rows.map((x: { projectId: string }) => [x.projectId, x]))
    expect(byId[P1]).toMatchObject({ state: 'ok', overallPct: 25 })
    expect(byId[P2]).toMatchObject({ state: 'no_events', overallPct: null })
    expect(byId[P3]).toMatchObject({ state: 'off', steps: [] })
    expect(calls.map((c) => c.p_project_id).sort()).toEqual([P1, P2].sort())
    expect(calls[0]).toMatchObject({ fn: 'product_funnel', p_window: '7 days', p_steps: ['signup_completed', 'first_lesson', 'day7_return'] })
    expect(r.body.data.from).toBe('2026-09-02T12:00:00.000Z')
  })

  it('only owners and admins set the funnel, and steps must be distinct event names', async () => {
    const { app, db } = setup()
    expect((await app.call('PUT', `/v1/admin/orgs/${ORG}/funnel`, { body: { steps: ['a1', 'b2'] }, vars: { userId: 'member' } })).status).toBe(403)
    expect((await app.call('PUT', `/v1/admin/orgs/${ORG}/funnel`, { body: { steps: ['signup', 'signup'] } })).status).toBe(400)
    expect((await app.call('PUT', `/v1/admin/orgs/${ORG}/funnel`, { body: { steps: ['Sign Up', 'paid'] } })).status).toBe(400)
    const ok = await app.call('PUT', `/v1/admin/orgs/${ORG}/funnel`, { body: { steps: ['signup_completed', 'first_lesson'], window: '1d' } })
    expect(ok.status).toBe(200)
    expect(db.table('org_funnel_definitions')[0]).toMatchObject({ organization_id: ORG, steps: ['signup_completed', 'first_lesson'], conversion_window: '1d', lookback_days: 30, updated_by: 'owner' })
  })
})
