/**
 * FILE: packages/server/src/__tests__/nav-meta-check-slices.test.ts
 * PURPOSE: Nav-meta forwards the last-run fields the checks cards read:
 *          audit lastRunAt, QA lastRunAt, inventory gate time, this app's
 *          last AI call (and this app's call window), and the judge run
 *          (including staleHours).
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

const PROJECT = 'proj-1'

let app: Hono
let clearNavMetaCache: () => void

beforeAll(async () => {
  const nav = await import('../../supabase/functions/api/routes/workspace-nav-meta.ts')
  clearNavMetaCache = nav.clearNavMetaCache
  app = new Hono()
  app.get('/v1/admin/fullstack-audit/stats', (c) => c.json({
    ok: true,
    data: {
      errorCount: 1,
      warnCount: 2,
      failedGateCount: 0,
      lastRunAt: '2026-10-25T12:00:00Z',
      topPriority: 'warnings',
      readError: null,
    },
  }))
  app.get(`/v1/admin/projects/${PROJECT}/qa-coverage/stats`, (c) => c.json({
    ok: true,
    data: {
      totalStories: 4,
      failingStories: 1,
      pendingRuns: 0,
      lastRunAt: '2026-10-25T11:00:00Z',
      topPriority: 'failing',
    },
  }))
  app.get('/v1/admin/inventory/stats', (c) => c.json({
    ok: true,
    data: {
      regressed: 0,
      openFindings: 0,
      stub: 0,
      total: 3,
      hasInventory: true,
      lastGateRunAt: '2026-10-25T10:00:00Z',
      topPriority: 'clear',
    },
  }))
  app.get('/v1/admin/health/stats', (c) => c.json({
    ok: true,
    data: {
      cronErrorCount: 2,
      redCount: 2,
      amberCount: 0,
      lastLlmCallAt: '2026-10-25T09:00:00Z',
      lastCronAt: '2026-10-25T08:00:00Z',
      totalCalls: 6,
      errorRatePct: 1,
      fallbackRatePct: 12,
      topPriority: 'cron_error',
    },
  }))
  app.get('/v1/admin/judge/stats', (c) => c.json({
    ok: true,
    data: {
      lastEvalAt: '2026-10-25T07:00:00Z',
      disagreementCount: 1,
      totalEvaluations: 9,
      staleHours: 17,
      topPriority: 'disagreements',
    },
  }))
  nav.registerWorkspaceNavMetaRoutes(app as never, async (c, next) => {
    c.set('userId', 'user-1')
    await next()
  })
})

describe('nav-meta check slices', () => {
  it('forwards last-run fields and the judge run, and does not forward platform cron time', async () => {
    clearNavMetaCache()
    const res = await app.request(
      `/v1/admin/workspace/nav-meta?slices=fullstackAudit,qaCoverage,inventory,health&include=counts&fresh=1`,
      { headers: { Authorization: 'Bearer user-jwt', 'X-Mushi-Project-Id': PROJECT } },
    )
    expect(res.status).toBe(200)
    const body = await res.json() as {
      ok: boolean
      data: {
        slices: {
          fullstackAudit: Record<string, unknown>
          qaCoverage: Record<string, unknown>
          inventory: Record<string, unknown>
          health: Record<string, unknown>
          judge: Record<string, unknown>
        }
      }
    }
    expect(body.data.slices.fullstackAudit).toMatchObject({
      errorCount: 1,
      warnCount: 2,
      lastRunAt: '2026-10-25T12:00:00Z',
      topPriority: 'warnings',
    })
    expect(body.data.slices.qaCoverage).toMatchObject({
      totalStories: 4,
      failingStories: 1,
      lastRunAt: '2026-10-25T11:00:00Z',
    })
    expect(body.data.slices.inventory).toMatchObject({
      hasInventory: true,
      lastGateRunAt: '2026-10-25T10:00:00Z',
      topPriority: 'clear',
    })
    expect(body.data.slices.health).toMatchObject({
      cronErrorCount: 2,
      lastLlmCallAt: '2026-10-25T09:00:00Z',
      totalCalls: 6,
      errorRatePct: 1,
      fallbackRatePct: 12,
      topPriority: 'cron_error',
    })
    expect(body.data.slices.health).not.toHaveProperty('lastCronAt')
    expect(body.data.slices.judge).toMatchObject({
      lastEvalAt: '2026-10-25T07:00:00Z',
      disagreementCount: 1,
      totalEvaluations: 9,
      staleHours: 17,
      topPriority: 'disagreements',
    })
  })
})
