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

  it('a stage-1 prompt filter matches reports that ran that version at stage 1 only', async () => {
    const res = await get('/v1/admin/judge/evaluations?prompt_version=v3&prompt_stage=stage1')
    expect(res.json.data.evaluations.map((e: Row) => e.report_id).sort()).toEqual(['r1', 'r10'])
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
