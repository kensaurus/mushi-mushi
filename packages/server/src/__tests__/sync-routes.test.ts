/**
 * /v1/sync/* (the CLI's API-key routes).
 *
 * - whoami ignored `error` on both counts and answered ok:true with zeros.
 * - stats counted only the nine pipeline statuses, so triaged / in_progress /
 *   verified / reopened reports (which the CLI's PATCH writes) were never in
 *   by_status.
 * - reports parsed ?limit / ?offset with parseInt and no fallback, so
 *   ?limit=abc put NaN into .range().
 * - reports put ( ) " from ?search straight into the .or() filter, so a
 *   search like "crash (android)" broke the PostgREST group.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000a-0000-4000-8000-000000000000'
let db: FakeDb
let failing: string | null = null

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('projectId', P)
    c.set('projectName', 'App')
    await next()
  }
  return {
    apiKeyAuth: pass,
    adminOrApiKey: () => pass,
    requireApiKeyScope: () => async (_c: unknown, next: () => Promise<void>) => next(),
  }
})
// The account key may read project P only.
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerCanAccessProject: async (_c: unknown, _db: unknown, _user: string, projectId: string) => ({
    allowed: projectId === P,
  }),
}))

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerSyncRoutes } = await import('../../supabase/functions/api/routes/sync.ts')
  app = new Hono()
  registerSyncRoutes(app as never)
})

beforeEach(() => {
  failing = null
  const reports = ['new', 'triaged', 'in_progress', 'verified', 'reopened', 'fixed'].map((status, i) => ({
    id: `r${i}`,
    project_id: P,
    status,
    severity: 'low',
    created_at: `2026-10-0${i + 1}`,
  }))
  db = makeFakeDb({ reports, fixes: [], lessons: [] }, { failRead: (t) => (t === failing ? 'connection reset' : null) })
})

async function get(path: string) {
  const res = await app.request(path)
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

describe('GET /v1/sync/whoami', () => {
  it('answers 500 when the count reads fail', async () => {
    failing = 'reports'
    const res = await get('/v1/sync/whoami')
    expect(res.status).toBe(500)
    expect(res.json.ok).toBe(false)
  })

  it('answers 500 when the linked repos cannot be read', async () => {
    failing = 'project_repos'
    const res = await get('/v1/sync/whoami')
    expect(res.status).toBe(500)
    expect(res.json.ok).toBe(false)
  })

  it('returns the project linked repos, primary first, without blanks', async () => {
    db = makeFakeDb({
      reports: [],
      project_repos: [
        { project_id: P, repo_url: 'https://github.com/acme/web', is_primary: false, created_at: '2026-10-01' },
        { project_id: P, repo_url: 'https://github.com/acme/app', is_primary: true, created_at: '2026-10-05' },
        { project_id: P, repo_url: '  ', is_primary: false, created_at: '2026-10-06' },
        { project_id: 'other-project', repo_url: 'https://github.com/acme/other', is_primary: true, created_at: '2026-10-01' },
      ],
    })
    const res = await get('/v1/sync/whoami')
    expect(res.status).toBe(200)
    expect(res.json.data.repo_urls).toEqual(['https://github.com/acme/app', 'https://github.com/acme/web'])
  })

  it('returns an empty repo list when the project links none', async () => {
    const res = await get('/v1/sync/whoami')
    expect(res.status).toBe(200)
    expect(res.json.data.repo_urls).toEqual([])
  })
})

describe('GET /v1/admin/projects/:id/ingest-setup', () => {
  // The SDK route refuses account keys, so MCP diagnose_setup on one used to
  // fail with ORG_KEY_NOT_ALLOWED instead of diagnosing.
  it('gives an account key the ingest steps of a project it can read', async () => {
    db = makeFakeDb({
      reports: [{ id: 'r1', project_id: P, environment: {}, created_at: '2026-10-01' }],
      project_api_keys: [],
      projects: [{ id: P, name: 'App', slug: 'app' }],
    })
    const res = await get(`/v1/admin/projects/${P}/ingest-setup`)
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ project_id: P, project_name: 'App', project_slug: 'app', ready: false })
    const steps = Object.fromEntries((res.json.data.steps as Array<{ id: string; complete: boolean }>).map((s) => [s.id, s.complete]))
    expect(steps).toMatchObject({ first_report_received: true, api_key_generated: false })
  })

  it('answers 404 for a project the key cannot read, and 400 for a non-UUID', async () => {
    expect((await get('/v1/admin/projects/2000000b-0000-4000-8000-000000000000/ingest-setup')).status).toBe(404)
    expect((await get('/v1/admin/projects/not-a-uuid/ingest-setup')).status).toBe(400)
  })
})

describe('GET /v1/sync/stats', () => {
  it('counts every status the constraint allows', async () => {
    const res = await get('/v1/sync/stats')
    expect(res.status).toBe(200)
    expect(res.json.data.by_status).toMatchObject({
      new: 1,
      triaged: 1,
      in_progress: 1,
      verified: 1,
      reopened: 1,
      fixed: 1,
      resolved: 0,
    })
  })
})

describe('GET /v1/sync/reports', () => {
  it('falls back to the default page for a non-numeric limit/offset', async () => {
    const res = await get('/v1/sync/reports?limit=abc&offset=-5')
    expect(res.status).toBe(200)
    expect(res.json.data).toMatchObject({ limit: 20, offset: 0, total: 6 })
    expect(res.json.data.reports).toHaveLength(6)
  })

  it('keeps PostgREST or() syntax in a search out of the filter', async () => {
    // The fake cannot evaluate ilike inside or(), so record the filter string.
    const proto = Object.getPrototypeOf(db.from('reports')) as { or: (f: string) => unknown }
    const filters: string[] = []
    const spy = vi.spyOn(proto, 'or').mockImplementation(function (this: unknown, f: string) {
      filters.push(f)
      return this
    })
    try {
      const res = await get(`/v1/sync/reports?search=${encodeURIComponent('crash (android), "x" 100%_')}`)
      expect(res.status).toBe(200)
    } finally {
      spy.mockRestore()
    }
    expect(filters).toHaveLength(1)
    expect(filters[0]).not.toMatch(/[()"]/)
    expect(filters[0].split(',')).toHaveLength(2)
    expect(filters[0]).toContain('100\\%\\_')
  })
})
