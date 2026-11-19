/**
 * FILE: apps/admin/src/components/prompt-lab/promptRecommendation.test.ts
 * PURPOSE: AI prompts leads with one plain recommendation and the button that acts on it
 *          (2026-11-19).
 */

import { describe, expect, it } from 'vitest'
import { MIN_GRADES_TO_SWITCH, MIN_LIFT_PCT, promptRecommendation } from './promptRecommendation'
import type { PromptVersion } from './types'

function v(stage: string, version: string, extra: Partial<PromptVersion> = {}): PromptVersion {
  return {
    id: `${stage}-${version}`, project_id: 'p1', stage: stage as PromptVersion['stage'], version, prompt_template: '',
    is_active: false, is_candidate: false, traffic_percentage: 0, avg_judge_score: null, total_evaluations: 0,
    cost_usd_total: 0, avg_cost_usd: null, created_at: '', updated_at: '', ...extra,
  }
}

const inUse = (stage: string, score: number | null = null) => v(stage, 'v1', { is_active: true, traffic_percentage: 100, avg_judge_score: score })

describe('promptRecommendation', () => {
  it('asks for more grades when a newer prompt leads on too few', () => {
    const rec = promptRecommendation([inUse('stage2'), v('stage2', 'v2', { is_candidate: true, traffic_percentage: 50, avg_judge_score: 0.49, total_evaluations: 6 })])
    expect(rec.sentence).toBe(`A newer Diagnosis prompt scores 49% vs no grade yet for the one in use. Not enough grades yet: ${MIN_GRADES_TO_SWITCH - 6} more needed.`)
    expect(rec.action).toEqual({ kind: 'grade' })
    expect(rec.actionLabel).toBe('Grade reports now')
  })

  it('says Switch to it once the newer prompt leads with enough grades', () => {
    const cand = v('stage2', 'v2', { is_candidate: true, traffic_percentage: 50, avg_judge_score: 0.72, total_evaluations: MIN_GRADES_TO_SWITCH })
    const rec = promptRecommendation([inUse('stage2', 0.61), cand])
    expect(rec.sentence).toBe('A newer Diagnosis prompt scores 72% vs 61% for the one in use. Switch to it.')
    expect(rec.action).toEqual({ kind: 'switch', version: cand })
    expect(rec.tone).toBe('ok')
  })

  it('matches the nightly auto-promotion: 30 grades and more than 5% better', () => {
    expect(MIN_GRADES_TO_SWITCH).toBe(30)
    const close = promptRecommendation([inUse('stage2', 0.8), v('stage2', 'v2', { is_candidate: true, traffic_percentage: 50, avg_judge_score: 0.82, total_evaluations: 40 })])
    expect(close.action).toEqual({ kind: 'open', stage: 'stage2' })
    expect(close.sentence).toBe(`The Diagnosis test scores 82% vs 80% for the one in use: not clearly better yet (it needs more than ${MIN_LIFT_PCT}% better).`)
  })

  it('never offers Switch for a built-in version: it can only be cloned', () => {
    const cand = v('stage2', 'v2', { project_id: null, is_candidate: true, traffic_percentage: 50, avg_judge_score: 0.9, total_evaluations: 50 })
    const rec = promptRecommendation([inUse('stage2', 0.6), cand])
    expect(rec.action).toEqual({ kind: 'open', stage: 'stage2' })
  })

  it('offers to start a test that gets no reports on half of them', () => {
    const cand = v('stage1', 'v2', { is_candidate: true, traffic_percentage: 0 })
    const rec = promptRecommendation([inUse('stage1'), cand])
    expect(rec.sentence).toBe('Fast filter has a test version that gets no reports, so it never gets graded. Start it on half of reports.')
    expect(rec.action).toEqual({ kind: 'start', version: cand, pct: 50 })
  })

  it('prefers a switch over a start over more grades', () => {
    const recs = promptRecommendation([
      inUse('stage1'),
      v('stage1', 'v2', { is_candidate: true, traffic_percentage: 0 }),
      inUse('stage2', 0.5),
      v('stage2', 'v2', { is_candidate: true, traffic_percentage: 10, avg_judge_score: 0.8, total_evaluations: 30 }),
    ])
    expect(recs.action?.kind).toBe('switch')
  })

  it('keeps the one in use when the test grades lower, and says so when nothing is tested', () => {
    expect(
      promptRecommendation([inUse('stage2', 0.8), v('stage2', 'v2', { is_candidate: true, traffic_percentage: 20, avg_judge_score: 0.6, total_evaluations: 40 })]).sentence,
    ).toBe('The Diagnosis test scores 60% vs 80% for the one in use: keep the one in use.')
    const none = promptRecommendation([inUse('stage1'), inUse('stage2')])
    expect(none.action).toBeNull()
    expect(none.sentence).toBe('Each step runs one prompt; nothing is being tested.')
  })
})
