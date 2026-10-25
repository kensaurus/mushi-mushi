/**
 * FILE: packages/server/src/__tests__/content-quality-stats.test.ts
 * PURPOSE: Content-quality stats stay the five count reads. The newest
 *          issue write is not a check run, so stats does not query it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1000000d-0000-4000-8000-000000000000'
const USER = '2000000d-0000-4000-8000-000000000000'

let db: FakeDb

vi.stubGlobal('Deno', { env: { get: () => undefined } })
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass, timingSafeEqual: () => false }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/api/shared.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    resolveOwnedProject: async () => ({ project: { id: P, name: 'glot.it' } }),
  }
})

let app: Hono

beforeAll(async () => {
  const { registerContentQualityRoutes } = await import('../../supabase/functions/api/routes/content-quality.ts')
  app = new Hono()
  registerContentQualityRoutes(app as never)
})

describe('content-quality/stats', () => {
  it('counts issues without a newest-write query or a latestAt field', async () => {
    db = makeFakeDb({
      content_quality_issues: [
        { id: '1', project_id: P, status: 'open', reason: 'user_flag', regen_status: null, updated_at: '2026-10-01T00:00:00Z' },
        { id: '2', project_id: P, status: 'in_review', reason: 'low', regen_status: 'failed', updated_at: '2026-10-02T00:00:00Z' },
        { id: '3', project_id: P, status: 'regenerating', reason: 'low', regen_status: null, updated_at: '2026-10-03T00:00:00Z' },
      ],
    })
    let issueReads = 0
    const orig = db.from.bind(db)
    db.from = (name: string) => {
      if (name === 'content_quality_issues') issueReads += 1
      return orig(name)
    }

    const res = await app.request('/v1/admin/content-quality/stats')
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> }
    expect(res.status).toBe(200)
    expect(body.data.openCount).toBe(1)
    expect(body.data.needsAttentionCount).toBe(2)
    expect(body.data.failedRegenCount).toBe(1)
    expect(body.data.topPriority).toBe('regen_failed')
    expect(body.data).not.toHaveProperty('latestAt')
    expect(issueReads).toBe(5)
  })
})
