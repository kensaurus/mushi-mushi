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
import { PromptScoreboard, scoreboardRows, splitScoreboardRows, stageVerdict } from './PromptScoreboard'

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
    expect(stageVerdict(row).text).toBe('Testing on 1 in 20 reports, waiting for grades')
  })

  it('calls a test at 0% of traffic not started, not running', () => {
    const row = { stage: 'stage1', active: v('stage1', 'v1', { is_active: true }), candidate: v('stage1', 'v2', { is_candidate: true, traffic_percentage: 0 }) }
    expect(stageVerdict(row)).toEqual({ text: 'Not started: gets no reports', tone: 'warn' })
  })
})

describe('splitScoreboardRows', () => {
  const g = {
    stage1: [v('stage1', 'v1', { is_active: true }), v('stage1', 'v2', { is_candidate: true })],
    fix: [v('fix', 'v1', { is_active: true })],
    judge: [v('judge', 'v1', { is_active: true })],
    nl_plan: [v('nl_plan', 'v1', { is_active: true, avg_judge_score: 0.5 })],
  }
  it('folds ungraded baseline-only steps into one group and keeps tests first', () => {
    const { shown, baselineOnly } = splitScoreboardRows(scoreboardRows(['fix', 'nl_plan', 'stage1', 'judge'], g))
    expect(shown.map((r) => r.stage)).toEqual(['stage1', 'nl_plan'])
    expect(baselineOnly.map((r) => r.stage)).toEqual(['fix', 'judge'])
  })
  it('does not group a single baseline row', () => {
    const { shown, baselineOnly } = splitScoreboardRows(scoreboardRows(['stage1', 'fix'], g))
    expect(shown.map((r) => r.stage)).toEqual(['stage1', 'fix'])
    expect(baselineOnly).toEqual([])
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

  it('has column headers and one grouped row for baseline-only steps', () => {
    const g = {
      stage1: [v('stage1', 'v1', { is_active: true }), v('stage1', 'v2', { is_candidate: true })],
      fix: [v('fix', 'v1', { is_active: true })],
      judge: [v('judge', 'v1', { is_active: true })],
    }
    act(() => root.render(createElement(PromptScoreboard, { stages: ['stage1', 'fix', 'judge'], grouped: g, selected: 'stage1', onOpen: vi.fn() })))
    expect(host.querySelector('[data-testid="prompt-scoreboard-head"]')?.textContent).toBe('PromptIn useTestingStatus')
    const group = host.querySelector('[data-testid="prompt-scoreboard-baseline"]')
    expect(group?.querySelector('summary')?.textContent).toContain('2 prompts')
    // Nothing on the page is graded: the status line says so once, rows do not repeat it
    // on every version (round-2 review 2026-11-18: "no grades yet" ×5).
    expect(group?.querySelector('summary')?.textContent).toContain('In use only')
    expect(host.textContent).not.toContain('no grades yet')
    expect(group?.querySelectorAll('li button')).toHaveLength(2)
  })

  it('names the missing grade per version once some version on the page has one', () => {
    const g = {
      stage1: [v('stage1', 'v1', { is_active: true, avg_judge_score: 0.8 }), v('stage1', 'v2', { is_candidate: true, traffic_percentage: 10 })],
      fix: [v('fix', 'v1', { is_active: true })],
      judge: [v('judge', 'v1', { is_active: true })],
    }
    act(() => root.render(createElement(PromptScoreboard, { stages: ['stage1', 'fix', 'judge'], grouped: g, selected: 'stage1', onOpen: vi.fn() })))
    expect(host.textContent).toContain('Testing: v2 · no grades yet')
    expect(host.querySelector('[data-testid="prompt-scoreboard-baseline"] summary')?.textContent).toContain('In use only, no grades yet')
  })

  it('shows the test that gets traffic, matching the banner (not a 0% one)', () => {
    const g = {
      stage2: [
        v('stage2', 'v1', { is_active: true, traffic_percentage: 100 }),
        v('stage2', 'v2-experiment', { is_candidate: true, traffic_percentage: 0 }),
        v('stage2', 'v3', { is_candidate: true, traffic_percentage: 50 }),
      ],
    }
    const [row] = scoreboardRows(['stage2'], g)
    expect(row!.candidate?.version).toBe('v3')
    expect(stageVerdict(row!).text).toBe('Testing on half of reports, waiting for grades')
  })
})
