/**
 * Triage grading > Prompts (round-2 review, 2026-11-18): fifteen flat rows printed Score "–"
 * and Evals "0" while the Grades tab held 2 grades, and Diagnosis printed 100% for the version
 * in use beside a test at 50%. Trend: one week drew a single dot on an empty 12-week chart.
 */
import { describe, expect, it } from 'vitest'
import { canDrawTrend, groupJudgePrompts, promptGradesLinked, type JudgePromptRow } from './judgePrompts'

function row(stage: string, version: string, extra: Partial<JudgePromptRow> = {}): JudgePromptRow {
  return {
    id: `${stage}-${version}`,
    project_id: null,
    stage,
    version,
    is_active: false,
    is_candidate: false,
    traffic_percentage: 0,
    avg_judge_score: null,
    total_evaluations: 0,
    created_at: '',
    ...extra,
  }
}

const prompts = [
  row('stage2', 'v1-baseline', { is_active: true, traffic_percentage: 100 }),
  row('stage1', 'v2-experiment', { is_candidate: true }),
  row('stage2', 'v2-experiment', { is_candidate: true }),
  row('stage1', 'v1-baseline', { is_active: true, traffic_percentage: 100 }),
  row('judge', 'v1-baseline', { is_active: true, traffic_percentage: 100 }),
  row('fix', 'v1-baseline', { is_active: true, traffic_percentage: 100 }),
  row('stage2', 'v3-visual-layout', { is_candidate: true, traffic_percentage: 50 }),
]

describe('groupJudgePrompts', () => {
  it('groups by step in pipeline order, in use first, and folds steps with nothing to compare', () => {
    const { steps, baselineOnly } = groupJudgePrompts(prompts)
    expect(steps.map((s) => s.label)).toEqual(['Fast filter', 'Diagnosis'])
    expect(steps[1]!.rows.map((r) => r.version)).toEqual(['v1-baseline', 'v3-visual-layout', 'v2-experiment'])
    expect(baselineOnly.map((s) => s.label)).toEqual(['Grading', 'Fix writer'])
  })

  it('gives the version in use the share the tests leave, so a step adds up to 100%', () => {
    const diagnosis = groupJudgePrompts(prompts).steps[1]!
    expect(diagnosis.rows.map((r) => r.share)).toEqual([50, 50, 0])
    expect(diagnosis.rows.reduce((sum, r) => sum + r.share, 0)).toBe(100)
  })
})

describe('promptGradesLinked', () => {
  it('flags grades that no version counts, instead of showing zeros', () => {
    expect(promptGradesLinked(prompts, 2)).toBe(false)
  })
  it('trusts the per-version numbers once one version counts a grade, or when nothing is graded', () => {
    expect(promptGradesLinked([...prompts, row('stage2', 'v4', { total_evaluations: 2, avg_judge_score: 0.7 })], 2)).toBe(true)
    expect(promptGradesLinked(prompts, 0)).toBe(true)
  })
})

describe('canDrawTrend', () => {
  it('needs two weeks before drawing a trend', () => {
    expect(canDrawTrend(0)).toBe(false)
    expect(canDrawTrend(1)).toBe(false)
    expect(canDrawTrend(2)).toBe(true)
  })
})
