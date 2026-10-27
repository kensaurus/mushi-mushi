/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/prompt-lab/PromptScoreboard.test.tsx
 * PURPOSE: AI prompts leads with each step's version in use and the version
 *          being tested, with their grades and a plain verdict, instead of a
 *          banner, four tiles and twelve stage tabs (console journeys 2026-10-27).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptVersion } from './types'
import { PromptScoreboard, scoreboardRows, stageVerdict } from './PromptScoreboard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function v(stage: string, version: string, extra: Partial<PromptVersion> = {}): PromptVersion {
  return {
    id: `${stage}-${version}`,
    project_id: 'p1',
    stage: stage as PromptVersion['stage'],
    version,
    prompt_template: '',
    is_active: false,
    is_candidate: false,
    traffic_percentage: 0,
    avg_judge_score: null,
    total_evaluations: 0,
    cost_usd_total: 0,
    avg_cost_usd: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...extra,
  }
}

const grouped = {
  stage2: [
    v('stage2', 'v3', { is_active: true, avg_judge_score: 0.71, total_evaluations: 40 }),
    v('stage2', 'v4', { is_candidate: true, traffic_percentage: 10, avg_judge_score: 0.77, total_evaluations: 9 }),
    v('stage2', 'v5', { is_candidate: true, traffic_percentage: 10, avg_judge_score: 0.6, total_evaluations: 9 }),
  ],
  judge: [v('judge', 'v1', { is_active: true, avg_judge_score: 0.9 })],
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('scoreboardRows + stageVerdict', () => {
  it('pairs the version in use with the best-graded test and says which leads', () => {
    const [stage2, judge] = scoreboardRows(['stage2', 'judge'], grouped)
    expect(stage2!.active?.version).toBe('v3')
    expect(stage2!.candidate?.version).toBe('v4')
    expect(stageVerdict(stage2!)).toEqual({ text: 'Test is ahead by 6 points: consider promoting it', tone: 'ok' })
    expect(stageVerdict(judge!)).toEqual({ text: 'Nothing being tested', tone: 'muted' })
  })

  it('never calls an ungraded test better or worse', () => {
    const row = { stage: 'stage1', active: v('stage1', 'v1', { is_active: true, avg_judge_score: 0.8 }), candidate: v('stage1', 'v2', { is_candidate: true, traffic_percentage: 5 }) }
    expect(stageVerdict(row).text).toBe('Test at 5% of traffic, waiting for grades')
  })
})

describe('PromptScoreboard', () => {
  it('lists each step with plain names and opens a step on click', () => {
    const onOpen = vi.fn()
    act(() => root.render(createElement(PromptScoreboard, { stages: ['stage2', 'judge'], grouped, selected: 'stage2', onOpen })))
    const rows = [...host.querySelectorAll('li button')]
    expect(rows[0]!.textContent).toContain('Diagnosis')
    expect(rows[0]!.textContent).toContain('In use: v3 · 71%')
    expect(rows[0]!.textContent).toContain('Testing: v4 · 77%')
    expect(rows[1]!.textContent).toContain('Grading')
    act(() => (rows[1] as HTMLButtonElement).click())
    expect(onOpen).toHaveBeenCalledWith('judge')
  })
})
