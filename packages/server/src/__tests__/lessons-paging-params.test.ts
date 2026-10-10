/**
 * Lessons routes parsed ?limit / ?offset with parseInt and no fallback, so
 * ?limit=abc reached .limit() / .range() as NaN. intParam now falls back to
 * the default and clamps to the route's bounds.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000a-0000-4000-8000-000000000000'
let db: FakeDb

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('projectId', P)
    c.set('authMethod', 'apiKey')
    await next()
  }
  return {
    jwtAuth: pass,
    apiKeyAuth: pass,
    adminOrApiKey: () => pass,
    requireApiKeyScope: () => async (_c: unknown, next: () => Promise<void>) => next(),
  }
})

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerLessonsRoutes } = await import('../../supabase/functions/api/routes/lessons.ts')
  app = new Hono()
  registerLessonsRoutes(app as never)
  db = makeFakeDb({
    lessons: [1, 2, 3].map((i) => ({
      id: `l${i}`,
      project_id: P,
      rule_text: `rule ${i}`,
      severity: 'low',
      frequency: i,
      last_reinforced_at: '2026-10-01',
      retired_at: null,
      created_at: '2026-10-01',
    })),
  })
})

describe('lessons paging params', () => {
  it('GET /v1/sync/lessons?limit=abc uses the default limit', async () => {
    const res = await app.request('/v1/sync/lessons?limit=abc')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown }
    expect(body.ok).toBe(true)
    expect(JSON.stringify(body.data)).toContain('rule 3')
  })

  it('GET /v1/admin/lessons?limit=abc&offset=xyz pages from the start', async () => {
    const res = await app.request('/v1/admin/lessons?limit=abc&offset=xyz')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; data: unknown[]; meta?: { limit: number; offset: number } }
    expect(body.ok).toBe(true)
    expect(body.data).toHaveLength(3)
  })
})
