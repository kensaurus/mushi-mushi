/**
 * FILE: judge-eligibility.test.ts
 * PURPOSE: Pins the "nothing to grade" contract shared by judge-batch,
 *          POST /v1/admin/judge/run and the dashboard staleness flag.
 *
 * Regression (2026-10-02): solo-boss-cloud had one report, graded on
 * 2026-09-18. Every run returned 200 with 0 evals and the inbox kept saying
 * "Judge scores are 335h old" with a Run button that could never clear it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  JUDGE_ELIGIBLE_STATUSES,
  isJudgeStale,
  judgeEmptyResult,
  judgeWeekLabel,
  onlyJudgeable,
} from '../../supabase/functions/_shared/judge-eligibility.ts'

const fnRoot = resolve(__dirname, '../../supabase/functions')
const read = (rel: string) => readFileSync(resolve(fnRoot, rel), 'utf8')

describe('judgeEmptyResult', () => {
  it('returns null when there is work, so LLM failures are not mislabelled', () => {
    expect(judgeEmptyResult({ projectsChecked: 1, judgeEnabledProjects: 1, eligibleReports: 2 })).toBeNull()
  })

  it('explains nothing_to_grade', () => {
    expect(judgeEmptyResult({ projectsChecked: 1, judgeEnabledProjects: 1, eligibleReports: 0 })).toMatchObject({
      evaluated: 0,
      reason: 'nothing_to_grade',
    })
  })

  it('explains judge_disabled before nothing_to_grade', () => {
    expect(judgeEmptyResult({ projectsChecked: 2, judgeEnabledProjects: 0, eligibleReports: 0 })?.reason).toBe(
      'judge_disabled',
    )
  })

  it('explains no_projects', () => {
    expect(judgeEmptyResult({ projectsChecked: 0, judgeEnabledProjects: 0, eligibleReports: 0 })?.reason).toBe(
      'no_projects',
    )
  })
})

describe('isJudgeStale', () => {
  it('is not stale when nothing is left to grade, however old the scores', () => {
    expect(isJudgeStale({ judgeStaleHours: 335, ungradedReports: 0 })).toBe(false)
    expect(isJudgeStale({ judgeStaleHours: null, ungradedReports: 0 })).toBe(false)
  })

  it('is stale when old scores and ungraded reports coexist', () => {
    expect(isJudgeStale({ judgeStaleHours: 49, ungradedReports: 1 })).toBe(true)
    expect(isJudgeStale({ judgeStaleHours: null, ungradedReports: 3 })).toBe(true)
  })

  it('is fresh within 48h', () => {
    expect(isJudgeStale({ judgeStaleHours: 12, ungradedReports: 5 })).toBe(false)
  })
})

describe('onlyJudgeable', () => {
  // Regression (2026-10-08): the-wanting-mind's /judge read 48 % because the
  // latest week held only two library-modernizer notices, filed already
  // `classified` by a cron with no classifier output to grade.
  function recorder() {
    const calls: string[] = []
    const q = {
      not(column: string, operator: string, value: unknown) {
        calls.push(`not ${column} ${operator} ${String(value)}`)
        return q
      },
      or(filters: string) {
        calls.push(`or ${filters}`)
        return q
      },
    }
    return { q, calls }
  }

  it('drops cron-filed reports, reports the classifier never ran on, and fixtures', () => {
    const { q, calls } = recorder()
    expect(onlyJudgeable(q)).toBe(q)
    expect(calls).toEqual([
      'not reporter_token_hash like cron:%',
      'or stage1_classification.not.is.null,stage2_analysis.not.is.null',
      'or custom_metadata->>source.is.null,custom_metadata->>source.not.in.(admin_test_report,mushi-marketing-seed)',
    ])
  })

  it('selects only the real, classifier-labelled reports (Postgres NULL semantics)', async () => {
    const s1 = { category: 'bug' }
    const db = makeFakeDb({
      reports: [
        { id: 'user', reporter_token_hash: 'rk1_a', stage1_classification: s1, custom_metadata: null },
        { id: 'sentry', reporter_token_hash: 'rk1_b', stage1_classification: s1, custom_metadata: { source: 'sentry_webhook' } },
        { id: 'stage2-only', reporter_token_hash: 'rk1_c', stage2_analysis: { x: 1 }, custom_metadata: {} },
        { id: 'modernizer', reporter_token_hash: 'cron:library-modernizer', stage1_classification: null },
        { id: 'unclassified', reporter_token_hash: 'rk1_d', stage1_classification: null, stage2_analysis: null },
        { id: 'console-test', reporter_token_hash: 'rk1_e', stage2_analysis: { x: 1 }, custom_metadata: { source: 'admin_test_report' } },
        { id: 'seed', reporter_token_hash: 'rk1_f', stage1_classification: s1, custom_metadata: { source: 'mushi-marketing-seed' } },
      ],
    })
    const { data } = await onlyJudgeable(db.from('reports').select('id'))
    expect((data as Array<{ id: string }>).map((r) => r.id).sort()).toEqual(['sentry', 'stage2-only', 'user'])
  })

  it('keeps reports without a metadata source (NOT IN alone would drop NULL)', () => {
    const { q, calls } = recorder()
    onlyJudgeable(q)
    expect(calls.at(-1)).toMatch(/^or custom_metadata->>source\.is\.null,/)
  })
})

describe('judgeWeekLabel', () => {
  // Thursday 2026-10-08; its ISO week starts Monday 2026-10-05.
  const now = new Date('2026-10-08T15:00:00Z')

  it('says "this week" only for the current ISO week', () => {
    expect(judgeWeekLabel('2026-10-05', now)).toBe('this week')
    expect(judgeWeekLabel('2026-10-05', new Date('2026-10-11T23:59:00Z'))).toBe('this week')
  })

  it('names an earlier week instead of calling it this week', () => {
    expect(judgeWeekLabel('2026-09-28', now)).toBe('week of Sep 28')
    expect(judgeWeekLabel('2026-10-05', new Date('2026-10-12T00:00:00Z'))).toBe('week of Oct 5')
  })
})

describe('call sites share one eligibility rule', () => {
  it('every "what can the judge grade" query applies onlyJudgeable', () => {
    for (const [file, sites] of [
      ['judge-batch/index.ts', 1],
      ['api/routes/judge.ts', 2],
      ['api/routes/dashboard.ts', 1],
    ] as const) {
      const src = read(file)
      const statusFilters = src.split(".in('status', [...JUDGE_ELIGIBLE_STATUSES])").length - 1
      const wrapped = src.split('onlyJudgeable(').length - 1
      expect(statusFilters, file).toBe(sites)
      expect(wrapped, file).toBe(sites)
    }
  })

  it('judge-batch selects with JUDGE_ELIGIBLE_STATUSES and reports the empty reason', () => {
    const src = read('judge-batch/index.ts')
    expect(src).toContain(".in('status', [...JUDGE_ELIGIBLE_STATUSES])")
    expect(src).toContain('judgeEmptyResult(')
    expect(src).not.toMatch(/\.in\('status', \['classified', 'grouped', 'fixing', 'fixed'\]\)/)
  })

  it('POST /judge/run pre-flights eligibility before the paid dispatch', () => {
    const src = read('api/routes/judge.ts')
    const route = src.slice(src.indexOf("app.post('/v1/admin/judge/run'"))
    const preflight = route.indexOf('judgeEmptyResult(')
    const dispatch = route.indexOf('functions/v1/judge-batch')
    expect(preflight).toBeGreaterThan(-1)
    expect(dispatch).toBeGreaterThan(preflight)
  })

  it('dashboard staleness is gated on ungraded reports', () => {
    const src = read('api/routes/dashboard.ts')
    expect(src).toContain('isJudgeStale(')
    expect(src).not.toContain('judgeStaleHours == null || judgeStaleHours > 48')
  })

  it('eligible statuses stay a subset of the reports_status_check values', () => {
    const allowed = [
      'new', 'pending', 'submitted', 'queued', 'classified', 'grouped', 'fixing', 'fixed',
      'dismissed', 'triaged', 'in_progress', 'resolved', 'verified', 'reopened',
    ]
    for (const s of JUDGE_ELIGIBLE_STATUSES) expect(allowed).toContain(s)
  })
})
