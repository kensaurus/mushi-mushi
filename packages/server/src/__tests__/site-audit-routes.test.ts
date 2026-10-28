/**
 * FILE: site-audit-routes.test.ts
 * PURPOSE: The site-audit settings routes (ADR 0040): turning it on needs an
 *          https address and a Firecrawl key and schedules the first run;
 *          an omitted page limit or cadence stays as stored; viewers cannot
 *          change it; Run now needs it on and is rate-limited.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000d-0000-4000-8000-000000000000'
const USER = '2000000d-0000-4000-8000-000000000000'

const state = vi.hoisted(() => ({ role: 'owner' as string, key: true, rateLimited: false, triggers: 0 }))
let db: FakeDb

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({
    ...db,
    from: db.from.bind(db),
    rpc: async () => (state.rateLimited ? { error: { message: 'rate_limit_exceeded' } } : { error: null }),
  }),
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass }
})
vi.mock('../../supabase/functions/_shared/audit.ts', () => ({ logAudit: async () => {} }))
vi.mock('../../supabase/functions/_shared/background.ts', () => ({
  runInBackground: () => {
    state.triggers++
  },
}))
vi.mock('../../supabase/functions/_shared/firecrawl.ts', () => ({ resolveFirecrawl: async () => (state.key ? { key: 'fc' } : null) }))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, userCanAccessProject: async () => ({ allowed: true, role: state.role }) }
})

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' })[k] } }
  const { registerSiteAuditRoutes } = await import('../../supabase/functions/api/routes/site-audit.ts')
  app = new Hono()
  registerSiteAuditRoutes(app as never)
})

beforeEach(() => {
  state.role = 'owner'
  state.key = true
  state.rateLimited = false
  state.triggers = 0
  db = makeFakeDb({ site_audits: [], site_audit_findings: [], site_watches: [{ project_id: P, base_url: 'https://tsumagoi.kensaur.us' }] }, { autoId: true })
})

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

const PATH = `/v1/admin/projects/${P}/site-audit`

describe('site-audit routes', () => {
  it('GET suggests the site-watch address before an audit exists', async () => {
    const res = await call('GET', PATH)
    expect(res.json.data).toMatchObject({ audit: null, findings: [], suggestedUrl: 'https://tsumagoi.kensaur.us', firecrawlReady: true })
  })

  it('PUT on: an https address and a key; the first run is scheduled now', async () => {
    expect((await call('PUT', PATH, { enabled: true, baseUrl: 'http://x.dev' })).json.error.code).toBe('INVALID_URL')
    state.key = false
    expect((await call('PUT', PATH, { enabled: true, baseUrl: 'https://tsumagoi.kensaur.us' })).status).toBe(412)
    state.key = true
    const on = await call('PUT', PATH, { enabled: true, baseUrl: 'https://tsumagoi.kensaur.us/', pageLimit: 120, cadenceDays: 3 })
    expect(on.status).toBe(200)
    expect(db.table('site_audits')[0]).toMatchObject({ project_id: P, enabled: true, base_url: 'https://tsumagoi.kensaur.us', page_limit: 120, cadence_days: 3 })
    expect(db.table('site_audits')[0].next_run_at).toBeTruthy()
    expect((await call('PUT', PATH, { enabled: true, pageLimit: 501 })).json.error.code).toBe('VALIDATION_ERROR')
  })

  it('PUT with a new cadence moves the next run to that many days after the last one', async () => {
    const lastRun = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const farOff = new Date(Date.now() + 86_400_000).toISOString()
    db = makeFakeDb(
      {
        site_audits: [{ id: 'sa1', project_id: P, enabled: true, base_url: 'https://tsumagoi.kensaur.us', cadence_days: 3, last_run_at: lastRun, next_run_at: farOff }],
        site_audit_findings: [],
        site_watches: [],
      },
      { autoId: true },
    )
    // Every day: the last run was 2 days ago, so it is due now.
    await call('PUT', PATH, { enabled: true, cadenceDays: 1 })
    const due = Date.parse(db.table('site_audits')[0].next_run_at as string)
    expect(Math.abs(due - Date.now())).toBeLessThan(60_000)
    // Every 7 days: 5 days from now, later than before.
    await call('PUT', PATH, { enabled: true, cadenceDays: 7 })
    expect(db.table('site_audits')[0].next_run_at).toBe(new Date(Date.parse(lastRun) + 7 * 86_400_000).toISOString())
    // The same cadence again leaves the schedule alone.
    db.table('site_audits')[0].next_run_at = farOff
    await call('PUT', PATH, { enabled: true, cadenceDays: 7 })
    expect(db.table('site_audits')[0].next_run_at).toBe(farOff)
  })

  it('PUT leaves page_limit and cadence_days stored when the body omits them', async () => {
    db = makeFakeDb(
      {
        site_audits: [{ id: 'sa1', project_id: P, enabled: true, base_url: 'https://tsumagoi.kensaur.us', page_limit: 139, cadence_days: 3 }],
        site_audit_findings: [],
        site_watches: [],
      },
      { autoId: true },
    )
    expect((await call('PUT', PATH, { enabled: true, cadenceDays: 1 })).status).toBe(200)
    expect(db.table('site_audits')[0]).toMatchObject({ page_limit: 139, cadence_days: 1 })
    expect((await call('PUT', PATH, { enabled: true, pageLimit: 50 })).status).toBe(200)
    expect(db.table('site_audits')[0]).toMatchObject({ page_limit: 50, cadence_days: 1 })
    expect((await call('PUT', PATH, { enabled: false })).status).toBe(200)
    expect(db.table('site_audits')[0]).toMatchObject({ enabled: false, page_limit: 50, cadence_days: 1 })
  })

  it('viewers cannot change it', async () => {
    state.role = 'viewer'
    expect((await call('PUT', PATH, { enabled: true, baseUrl: 'https://tsumagoi.kensaur.us' })).status).toBe(403)
  })

  it('Run now needs the audit on, starts the worker, and is rate-limited', async () => {
    expect((await call('POST', `${PATH}/run`)).status).toBe(404)
    await call('PUT', PATH, { enabled: true, baseUrl: 'https://tsumagoi.kensaur.us' })
    const run = await call('POST', `${PATH}/run`)
    expect(run.json).toEqual({ ok: true, data: { running: true } })
    expect(state.triggers).toBe(1)
    state.rateLimited = true
    expect((await call('POST', `${PATH}/run`)).status).toBe(429)
  })
})
