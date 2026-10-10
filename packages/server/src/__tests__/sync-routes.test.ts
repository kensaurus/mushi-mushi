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
  return { apiKeyAuth: pass, requireApiKeyScope: () => async (_c: unknown, next: () => Promise<void>) => next() }
})

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
