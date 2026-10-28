/**
 * FILE: judge-routes-console.test.ts
 * PURPOSE: /judge console QA group C, against the real judge route module.
 *
 *   #247  "Disagreements only" filtered the latest 50 rows in the browser,
 *         and a prompt row's stage was dropped. The route now filters
 *         disagreements, stage and date range over every evaluation, pages
 *         them, and returns the total.
 *   #248  The low-score banner button reads "Review evaluations" but opened
 *         Prompt Lab. It now opens the lowest-scored evaluations.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb, type Row } from './__stubs__/fake-supabase.ts'
import { createFakeDb as createRecorder, eqValue } from './__stubs__/fake-query-recorder.ts'

const P = '1000000e-0000-4000-8000-000000000000'
const USER = '2000000e-0000-4000-8000-000000000000'

let db: FakeDb

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    c.set('authMethod', 'jwt')
    await next()
  }
  return { jwtAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/api/shared.ts', () => ({
  dbError: (c: { json: (b: unknown, s: number) => Response }, e: { message: string }) =>
    c.json({ ok: false, error: { code: 'DB_ERROR', message: e.message } }, 500),
  callerProjectIds: async () => [P],
  resolveOwnedProject: async () => ({ project: { id: P, name: 'App' } }),
}))

let app: Hono
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  const { registerJudgeRoutes } = await import('../../supabase/functions/api/routes/judge.ts')
  app = new Hono()
  registerJudgeRoutes(app as never)
})

function evaluation(i: number, extra: Row = {}): Row {
  return {
    id: `e${i}`,
    project_id: P,
    report_id: `r${i}`,
    judge_model: 'm',
    judge_score: 0.5,
    classification_agreed: true,
    prompt_version: 'v3',
    created_at: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(),
    ...extra,
  }
}

async function get(path: string) {
  const res = await app.request(path)
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

describe('#247 evaluations filters run over every evaluation', () => {
  beforeEach(() => {
    // 60 recent agreements, then 3 older disagreements the latest 50 never saw.
    const rows = Array.from({ length: 60 }, (_, i) => evaluation(i + 10))
    rows.push(evaluation(1, { classification_agreed: false }))
    rows.push(evaluation(2, { classification_agreed: false }))
    rows.push(evaluation(3, { classification_agreed: false, prompt_version: 'v4' }))
    db = makeFakeDb({
      classification_evaluations: rows,
      reports: [
        { id: 'r1', project_id: P, stage1_prompt_version: 'v3', stage2_prompt_version: 'v9' },
        { id: 'r2', project_id: P, stage1_prompt_version: 'v1', stage2_prompt_version: 'v3' },
        { id: 'r10', project_id: P, stage1_prompt_version: 'v3', stage2_prompt_version: null },
      ],
    })
  })

  it('returns every disagreement with a total, not the few among the latest 50', async () => {
    const res = await get('/v1/admin/judge/evaluations?limit=50&disagreement=1')
    expect(res.json.data.evaluations.map((e: Row) => e.id).sort()).toEqual(['e1', 'e2', 'e3'])
    expect(res.json.data.total).toBe(3)
  })

  it('pages the full list and reports its total', async () => {
    const first = await get('/v1/admin/judge/evaluations?limit=50&page=1')
    const second = await get('/v1/admin/judge/evaluations?limit=50&page=2')
    expect(first.json.data.evaluations).toHaveLength(50)
    expect(second.json.data.evaluations).toHaveLength(13)
    expect(first.json.data.total).toBe(63)
  })

  it('a stage-1 prompt filter joins on the report’s stage-1 version, in one query', async () => {
    // The in-memory fake cannot run PostgREST embedded filters, so this
    // asserts the query the route sends.
    const recorder = createRecorder((q) =>
      q.table === 'classification_evaluations'
        ? { data: [{ ...evaluation(1), reports: { stage1_prompt_version: 'v3' } }] }
        : { data: [] },
    )
    db = recorder.db as unknown as FakeDb
    const res = await get('/v1/admin/judge/evaluations?prompt_version=v3&prompt_stage=stage1')
    const evalQuery = recorder.queries.find((q) => q.table === 'classification_evaluations')!
    expect(evalQuery.columns).toContain('reports!inner(stage1_prompt_version)')
    expect(eqValue(evalQuery, 'reports.stage1_prompt_version')).toBe('v3')
    expect(eqValue(evalQuery, 'prompt_version')).toBeUndefined()
    // The join column is not part of the row the console reads.
    expect(res.json.data.evaluations[0]).not.toHaveProperty('reports')
  })

  it('filters by the trend brush range and ignores a malformed one', async () => {
    const from = new Date(Date.UTC(2026, 8, 1)).toISOString()
    const to = new Date(Date.UTC(2026, 8, 1, 2, 30)).toISOString()
    const res = await get(`/v1/admin/judge/evaluations?from=${from}&to=${to}`)
    expect(res.json.data.evaluations.map((e: Row) => e.id).sort()).toEqual(['e1', 'e2'])
    const bad = await get('/v1/admin/judge/evaluations?from=nope&to=also-nope')
    expect(bad.json.data.total).toBe(63)
  })
})

describe('#248 low-score banner target', () => {
  it('opens the lowest-scored evaluations, matching its "Review evaluations" label', async () => {
    db = makeFakeDb(
      {
        classification_evaluations: [evaluation(1)],
        reports: [],
        prompt_versions: [],
      },
      { rpc: () => [{ week_start: '2026-09-28', avg_score: 0.42, eval_count: 9 }] },
    )
    const res = await get('/v1/admin/judge/stats')
    expect(res.json.data.topPriority).toBe('low_score')
    expect(res.json.data.topPriorityTo).toBe(`/judge?tab=evaluations&sort=score_asc&project=${P}`)
  })
})

describe('64c2b3df "recent" disagreement share is really recent', () => {
  const day = 86_400_000
  const ago = (days: number) => new Date(Date.now() - days * day).toISOString()

  it('labels the share with its window and returns the weekly agreement trend', async () => {
    // Old history: 10 disagreements 60 days ago. Last 14 days: 1 of 10.
    const rows: Row[] = [
      ...Array.from({ length: 10 }, (_, i) => evaluation(100 + i, { classification_agreed: false, created_at: ago(60) })),
      ...Array.from({ length: 9 }, (_, i) => evaluation(200 + i, { created_at: ago(2) })),
      evaluation(300, { classification_agreed: false, created_at: ago(1) }),
    ]
    db = makeFakeDb(
      { classification_evaluations: rows, reports: [], prompt_versions: [] },
      { rpc: () => [{ week_start: '2026-10-19', avg_score: 0.9, eval_count: 10 }] },
    )
    const res = await get('/v1/admin/judge/stats')
    const d = res.json.data
    // All-time stays all-time…
    expect(d.disagreementCount).toBe(11)
    expect(d.disagreementRatePct).toBe(55)
    // …and the recent window is its own number, so a 10% recent share is not flagged.
    expect(d.recentWindowDays).toBe(14)
    expect(d.recentEvaluations).toBe(10)
    expect(d.recentDisagreements).toBe(1)
    expect(d.topPriority).not.toBe('disagreements')
    // Weekly trend, oldest first: the 60-day-old week was all disagreements.
    expect(d.agreementWeeks[0]).toMatchObject({ graded: 10, agreed: 0 })
    const graded = d.agreementWeeks.reduce((n: number, w: { graded: number }) => n + w.graded, 0)
    expect(graded).toBe(20)
  })

  it('says "in the last 14 days" when that window is narrower than all grades', async () => {
    const rows: Row[] = [
      ...Array.from({ length: 10 }, (_, i) => evaluation(400 + i, { created_at: ago(60) })),
      ...Array.from({ length: 6 }, (_, i) =>
        evaluation(500 + i, { classification_agreed: i >= 3, created_at: ago(3) }),
      ),
    ]
    db = makeFakeDb(
      { classification_evaluations: rows, reports: [], prompt_versions: [] },
      { rpc: () => [{ week_start: '2026-10-19', avg_score: 0.9, eval_count: 6 }] },
    )
    const d = (await get('/v1/admin/judge/stats')).json.data
    expect(d.topPriority).toBe('disagreements')
    expect(d.topPriorityLabel).toContain('50% of the 6 grades in the last 14 days')
    expect(d.topPriorityLabel).not.toMatch(/recent grades/)
  })

  it('calls a 14-day window that holds every grade all-time, not recent', async () => {
    // 76/144 = 53%. Every grade is 3 days old, so "last 14 days" is the whole history.
    const rows: Row[] = Array.from({ length: 144 }, (_, i) =>
      evaluation(800 + i, { classification_agreed: i >= 76, created_at: ago(3) }),
    )
    db = makeFakeDb(
      { classification_evaluations: rows, reports: [], prompt_versions: [] },
      { rpc: () => [{ week_start: '2026-10-19', avg_score: 0.9, eval_count: 144 }] },
    )
    const d = (await get('/v1/admin/judge/stats')).json.data
    expect(d.disagreementCount).toBe(76)
    expect(d.disagreementRatePct).toBe(53)
    expect(d.recentEvaluations).toBe(144)
    expect(d.topPriority).toBe('disagreements')
    expect(d.topPriorityLabel).toContain('53% of all 144 grades so far')
    expect(d.topPriorityLabel).not.toMatch(/14 days|recent/)
  })
})

describe('agreement trend reads past the 1,000-row page', () => {
  it('counts every grade in the 12 weeks when PostgREST caps each answer at 1,000 rows', async () => {
    const day = 86_400_000
    const rows: Row[] = Array.from({ length: 1500 }, (_, i) =>
      evaluation(1000 + i, { created_at: new Date(Date.now() - (i % 70) * day - 3_600_000).toISOString(), classification_agreed: i % 5 !== 0 }),
    )
    db = makeFakeDb(
      { classification_evaluations: rows, reports: [], prompt_versions: [] },
      { maxRows: 1000, rpc: () => [{ week_start: '2026-10-19', avg_score: 0.9, eval_count: 10 }] },
    )
    const d = (await get('/v1/admin/judge/stats')).json.data
    const graded = d.agreementWeeks.reduce((n: number, w: { graded: number }) => n + w.graded, 0)
    expect(graded).toBe(1500)
    expect(d.agreementCapped).toBe(false)
  })
})
