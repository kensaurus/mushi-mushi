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
import {
  JUDGE_ELIGIBLE_STATUSES,
  isJudgeStale,
  judgeEmptyResult,
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

describe('call sites share one eligibility rule', () => {
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
