/**
 * FILE: packages/server/src/__tests__/nav-meta-check-slices.test.ts
 * PURPOSE: Nav-meta does not forward timestamps the checks cards ignore.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

vi.stubGlobal('Deno', { env: { get: () => undefined } })
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({ from: () => ({}) }) }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let app: Hono
let clearNavMetaCache: () => void

beforeAll(async () => {
  const nav = await import('../../supabase/functions/api/routes/workspace-nav-meta.ts')
  clearNavMetaCache = nav.clearNavMetaCache
  app = new Hono()
  app.get('/v1/admin/content-quality/stats', (c) => c.json({
    ok: true,
    data: {
      openCount: 1,
      inReviewCount: 0,
      regeneratingCount: 0,
      userFlagOpenCount: 0,
      failedRegenCount: 0,
      needsAttentionCount: 1,
      latestAt: '2026-10-25T12:00:00Z',
      topPriority: 'open_issues',
    },
  }))
  app.get('/v1/admin/lessons/stats', (c) => c.json({
    ok: true,
    data: {
      activeLessons: 4,
      readyToPromote: 1,
      criticalLessons: 2,
      lastLessonReinforcedAt: '2026-10-25T12:00:00Z',
      topPriority: 'critical_lessons',
    },
  }))
  nav.registerWorkspaceNavMetaRoutes(app as never, async (c, next) => {
    c.set('userId', 'user-1')
    await next()
  })
})

describe('nav-meta check slices', () => {
  it('does not copy content latestAt or lesson reinforcement time into the slice', async () => {
    clearNavMetaCache()
    const res = await app.request('/v1/admin/workspace/nav-meta?slices=contentQuality,lessons&fresh=1')
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; data: { slices: { contentQuality: Record<string, unknown>; lessons: Record<string, unknown> } } }
    expect(body.data.slices.contentQuality).toMatchObject({ openCount: 1, needsAttentionCount: 1, topPriority: 'open_issues' })
    expect(body.data.slices.contentQuality).not.toHaveProperty('latestAt')
    expect(body.data.slices.lessons).toMatchObject({ criticalLessons: 2, readyToPromote: 1, topPriority: 'critical_lessons' })
    expect(body.data.slices.lessons).not.toHaveProperty('lastLessonReinforcedAt')
  })
})
