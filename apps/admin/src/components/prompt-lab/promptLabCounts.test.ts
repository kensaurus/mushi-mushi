/**
 * 2026-11-18: AI prompts said "A/B running — no judge scores yet" and "3 being
 * tested, 3 with no grades" while the rows showed two steps with a test, both at
 * 0% of traffic, and no grade anywhere. The counts now come from the prompt list.
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_PROMPT_LAB_STATS } from './PromptLabStatsTypes'
import type { PromptVersion } from './types'
import { promptTestCounts, reconcilePromptLabStats } from './promptLabCounts'

function v(stage: string, version: string, extra: Partial<PromptVersion> = {}): PromptVersion {
  return {
    id: `${stage}-${version}`, project_id: null, stage: stage as PromptVersion['stage'], version, prompt_template: '',
    is_active: false, is_candidate: false, traffic_percentage: 0, avg_judge_score: null, total_evaluations: 0,
    cost_usd_total: 0, avg_cost_usd: null, created_at: '', updated_at: '', ...extra,
  }
}

const prompts = [
  v('stage1', 'v1', { is_active: true, traffic_percentage: 100 }),
  v('stage1', 'v2', { is_candidate: true }),
  v('stage2', 'v1', { is_active: true, traffic_percentage: 100 }),
  v('stage2', 'v2', { is_candidate: true }),
  v('stage2', 'v3', { is_candidate: true }),
  v('judge', 'v1', { is_active: true, traffic_percentage: 100 }),
]

describe('promptTestCounts', () => {
  it('counts steps with a test, not candidate rows', () => {
    expect(promptTestCounts(prompts)).toEqual({ inUse: 3, stepsWithTest: 2, runningUngraded: 0, notStarted: 2, noGrades: true })
  })
})

describe('reconcilePromptLabStats', () => {
  const server = { ...EMPTY_PROMPT_LAB_STATS, hasAnyProject: true, activePrompts: 3, candidatePrompts: 3, untestedAbCount: 3, topPriority: 'untested_ab' as const, topPriorityLabel: '3 candidate prompts in A/B but not scored by the judge yet.' }

  it('reads tests at 0% of traffic as not started, with the scoreboard counts', () => {
    const s = reconcilePromptLabStats(server, prompts)
    expect(s.candidatePrompts).toBe(2)
    expect(s.untestedAbCount).toBe(0)
    expect(s.topPriority).toBe('candidates_idle')
    expect(s.topPriorityLabel).toBe('2 steps with a test version that gets 0% of traffic.')
  })

  it('keeps "running, no grades" when a test gets traffic', () => {
    const running = prompts.map((p) => (p.id === 'stage1-v2' ? { ...p, traffic_percentage: 10 } : p))
    const s = reconcilePromptLabStats(server, running)
    expect(s.topPriority).toBe('untested_ab')
    expect(s.untestedAbCount).toBe(1)
    expect(s.topPriorityLabel).toBe('1 step testing a version that has no grades yet.')
  })

  it('leaves the server stats alone before the list loads', () => {
    expect(reconcilePromptLabStats(server, null)).toBe(server)
  })
})
