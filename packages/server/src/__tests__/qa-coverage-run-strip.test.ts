/**
 * The 7-day pass/fail strip on /qa-coverage (`api/routes/qa-coverage.ts`,
 * console journeys 2026-10-27).
 *
 * Each story gets one entry per UTC day, oldest first, today last. Only runs
 * that finished count: skipped, pending and running runs are left out, so a
 * skipped story is never drawn as failing. The list route reads the runs in
 * pages (PostgREST stops at 1,000 rows) and leaves the strip out (null) when
 * that read fails, instead of drawing empty days.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'

const P = '1000000e-0000-4000-8000-0000000000aa'
let db: FakeDb

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', 'u1')
    await next()
  }
  return { jwtAuth: pass, apiKeyAuth: pass, requireApiKeyScope: () => pass }
})
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => Response }, e: { message: string }) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: e.message } }, 500),
  ownedProjectIds: async () => [P],
  jsonError: (c: { json: (b: unknown, s: number) => Response }, s: number, code: string, message: string) =>
    c.json({ ok: false, error: { code, message } }, s),
  userCanAccessProject: async () => true,
}))

type Mod = typeof import('../../supabase/functions/api/routes/qa-coverage.ts')
let mod: Mod
let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  mod = await import('../../supabase/functions/api/routes/qa-coverage.ts')
  app = new Hono()
  mod.registerQaCoverageRoutes(app as never)
})

const NOW = Date.UTC(2026, 9, 27, 15, 0, 0)
const at = (daysAgo: number, hour = 9) => new Date(Date.UTC(2026, 9, 27 - daysAgo, hour)).toISOString()

describe('buildRunStrips', () => {
  it('gives each story 7 UTC days, oldest first, and counts only finished runs', () => {
    const strips = mod.buildRunStrips(
      [
        { story_id: 's1', status: 'passed', started_at: at(0) },
        { story_id: 's1', status: 'failed', started_at: at(0, 10) },
        { story_id: 's1', status: 'timeout', started_at: at(6) },
        { story_id: 's1', status: 'skipped', started_at: at(3) },
        { story_id: 's1', status: 'running', started_at: at(1) },
        { story_id: 's1', status: 'passed', started_at: at(7) },
        { story_id: 's2', status: 'skipped', started_at: at(2) },
      ],
      NOW,
    )
    const s1 = strips.get('s1')!
    expect(s1.map((d) => d.day)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'])
    expect(s1[0]).toEqual({ day: '2026-10-21', passed: 0, failed: 1 })
    expect(s1[6]).toEqual({ day: '2026-10-27', passed: 1, failed: 1 })
    // Skipped and running runs are not failures.
    expect(s1[4]).toEqual({ day: '2026-10-25', passed: 0, failed: 0 })
    // A story with only skipped runs has no strip entry of its own.
    expect(strips.has('s2')).toBe(false)
  })
})

describe('GET /qa-coverage strip', () => {
  const story: Row = { id: 's1', project_id: P, name: 'Checkout', enabled: true, browser_provider: 'local', last_run_status: 'passed', updated_at: new Date().toISOString(), script: null, created_at: '2026-01-01' }

  beforeEach(() => {
    const now = Date.now()
    const runs: Row[] = Array.from({ length: 1500 }, (_, i) => ({
      id: `r${i}`,
      project_id: P,
      story_id: 's1',
      status: i % 3 === 0 ? 'failed' : 'passed',
      started_at: new Date(now - (i % 5) * 3_600_000).toISOString(),
    }))
    db = makeFakeDb(
      { qa_stories: [story], qa_story_runs: runs, qa_story_coverage_24h: [] },
      { maxRows: 1000, rpcError: () => ({ code: 'PGRST202', message: 'missing' }) },
    )
  })

  it('reads past the 1,000-row page and attaches the strip to each story', async () => {
    const res = await app.request(`/v1/admin/projects/${P}/qa-coverage`)
    const body = (await res.json()) as { data: { coverage: Array<{ story_id: string; last_7d: Array<{ passed: number; failed: number }> | null }> } }
    const strip = body.data.coverage[0]!.last_7d!
    expect(strip).toHaveLength(7)
    const total = strip.reduce((n, d) => n + d.passed + d.failed, 0)
    expect(total).toBe(1500)
  })
})

describe('1d625b63 skipped runs are not failures', () => {
  it('rates a story over finished runs only', () => {
    expect(mod.finishedPassRate({ runs_24h: 4, passed_24h: 0, failed_24h: 0, error_24h: 0 })).toBeNull()
    expect(mod.finishedPassRate({ runs_24h: 10, passed_24h: 3, failed_24h: 1, error_24h: 0 })).toBe(75)
    expect(mod.finishedPassRate(undefined)).toBeNull()
  })

  it('does not count a story that only skipped as failing in the stats', async () => {
    db = makeFakeDb(
      {
        projects: [{ id: P, name: 'App' }],
        qa_stories: [
          { id: 's1', project_id: P, name: 'Checkout', enabled: true },
          { id: 's2', project_id: P, name: 'Login', enabled: true },
        ],
        qa_story_coverage_24h: [
          { story_id: 's1', project_id: P, runs_24h: 6, passed_24h: 0, failed_24h: 0, error_24h: 0, pass_rate_pct: 0 },
          { story_id: 's2', project_id: P, runs_24h: 4, passed_24h: 1, failed_24h: 3, error_24h: 0, pass_rate_pct: 25 },
        ],
        qa_story_runs: [],
      },
      { maxRows: 1000 },
    )
    const res = await app.request(`/v1/admin/projects/${P}/qa-coverage/stats`)
    const d = ((await res.json()) as { data: { failingStories: number; topFailingStoryName: string | null } }).data
    expect(d.failingStories).toBe(1)
    expect(d.topFailingStoryName).toBe('Login')
  })
})
