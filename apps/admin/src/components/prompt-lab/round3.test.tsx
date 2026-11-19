/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/prompt-lab/round3.test.tsx
 * PURPOSE: Round-3 sweep (2026-11-19) on AI prompts and Triage grading:
 *   - eval dataset rows are one line with the body behind "Show" (they printed whole bodies);
 *   - one word and mark for a version's state on both pages;
 *   - the test state is one status line: "1 test running · 1 not started".
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EvalDatasetCard } from './EvalDatasetCard'
import { versionState } from './VersionStateMark'
import { promptTestSummary } from './promptLabCounts'
import { PromptLabSnapshotStrip, promptLabLineState } from './PromptLabSnapshotStrip'
import { EMPTY_PROMPT_LAB_STATS } from './PromptLabStatsTypes'
import type { PromptVersion } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

const BODY = 'Your app installs minimatch 10.2.6.\nVersion 11.0.1 fixes it. ' + 'How to fix: '.repeat(40)

describe('EvalDatasetCard', () => {
  it('shows one truncated line per report and the body only after Show', () => {
    act(() => {
      root.render(
        createElement(MemoryRouter, null,
          createElement(EvalDatasetCard, {
            total: 4,
            labelled: 4,
            recentSamples: [{ id: 'r1', description: BODY, category: 'other', severity: 'medium', component: 'minimatch', created_at: new Date().toISOString() }],
          }),
        ),
      )
    })
    const link = host.querySelector('[data-testid="eval-dataset-row"] a')!
    const cls = link.getAttribute('class') ?? ''
    expect(cls).toContain('truncate')
    // `block` beside line-clamp cancelled the clamp; neither is on the link now.
    expect(cls).not.toMatch(/\bblock\b/)
    expect(host.querySelector('[data-testid="eval-dataset-body"]')).toBeNull()
    const show = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Show')!
    expect(show.getAttribute('aria-expanded')).toBe('false')
    act(() => show.click())
    expect(host.querySelector('[data-testid="eval-dataset-body"]')?.textContent).toBe(BODY)
    expect(show.textContent).toBe('Hide')
  })
})

function v(stage: string, version: string, extra: Partial<PromptVersion> = {}): PromptVersion {
  return {
    id: `${stage}-${version}`, project_id: null, stage: stage as PromptVersion['stage'], version, prompt_template: '',
    is_active: false, is_candidate: false, traffic_percentage: 0, avg_judge_score: null, total_evaluations: 0,
    cost_usd_total: 0, avg_cost_usd: null, created_at: '', updated_at: '', ...extra,
  }
}

describe('version state', () => {
  it('names a 0%-traffic test "Not started" and a running one "Testing"', () => {
    expect(versionState({ is_active: true, is_candidate: false, traffic_percentage: 100 })).toEqual({ label: 'In use', tone: 'ok' })
    expect(versionState({ is_active: false, is_candidate: true, traffic_percentage: 0 })).toEqual({ label: 'Not started', tone: 'warn' })
    expect(versionState({ is_active: false, is_candidate: true, traffic_percentage: 50 })).toEqual({ label: 'Testing', tone: 'info' })
    expect(versionState({ is_active: false, is_candidate: false, traffic_percentage: 0 })).toEqual({ label: 'Idle', tone: 'off' })
  })
})

describe('one status line for tests and grades', () => {
  const prompts = [
    v('stage1', 'v1', { is_active: true, traffic_percentage: 100 }),
    v('stage1', 'v2', { is_candidate: true, traffic_percentage: 0 }),
    v('stage2', 'v1', { is_active: true, traffic_percentage: 50 }),
    v('stage2', 'v3', { is_candidate: true, traffic_percentage: 50 }),
  ]

  it('says "1 test running · 1 not started" and counts one step testing', () => {
    expect(promptTestSummary(prompts)).toEqual({ text: '1 test running · 1 not started', testing: 1 })
    expect(promptTestSummary([v('stage1', 'v1', { is_active: true })])).toBeNull()
  })

  it('leads the status line with the test state and shows a dash, not "No grades", in the tile', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null,
        createElement(PromptLabSnapshotStrip, {
          stats: { ...EMPTY_PROMPT_LAB_STATS, hasAnyProject: true, activePrompts: 12, candidatePrompts: 2 },
          statsFetchedAt: null,
          testSummary: promptTestSummary(prompts),
        }),
      ),
    )
    expect(html).toContain('1 test running · 1 not started. No version has a grade yet.')
    expect(html).toContain('Steps testing')
    expect(html).not.toContain('Steps with a test')
    expect(html).not.toContain('>No grades<')
    expect(html).toContain('Open prompts')
  })

  it('keeps the warning and its "Set traffic %" step when every test sits at 0%', () => {
    const idle = [
      v('stage1', 'v1', { is_active: true, traffic_percentage: 100 }),
      v('stage1', 'v2', { is_candidate: true, traffic_percentage: 0 }),
    ]
    const summary = promptTestSummary(idle)
    expect(summary).toEqual({ text: '1 not started', testing: 0 })
    expect(promptLabLineState(summary)).toEqual({ tone: 'warn', action: 'Set traffic %' })
    expect(promptLabLineState(null)).toEqual({ tone: 'neutral', action: null })
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null,
        createElement(PromptLabSnapshotStrip, {
          stats: { ...EMPTY_PROMPT_LAB_STATS, hasAnyProject: true },
          statsFetchedAt: null,
          testSummary: summary,
          promptsHref: '/prompt-lab?tab=prompts&stage=stage1',
        }),
      ),
    )
    expect(html).toContain('Set traffic %')
    expect(html).toContain('href="/prompt-lab?tab=prompts&amp;stage=stage1"')
  })
})
