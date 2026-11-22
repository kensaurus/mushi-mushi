/**
 * @vitest-environment jsdom
 *
 * The Opus verdict is a status pill (merge ✓, hold ✕, fix-first slow,
 * reviewing runs), findings carry their severity shape, and a vital in the
 * summary is a graded badge (2026-11-18).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FixReviewSummary } from './FixReviewSummary'
import type { FixReview } from '../../lib/fixReview'

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

const base: FixReview = {
  state: 'merge',
  label: 'Merge',
  verdict: 'merge',
  fixesReport: true,
  risk: 'low',
  findings: [],
  scopeCreep: null,
  removesBehavior: [],
  needsHumanDecision: null,
  summary: null,
  rulesApplied: [],
} as unknown as FixReview

function render(review: FixReview) {
  act(() => root.render(createElement(FixReviewSummary, { review, loading: false, error: null, rerunning: false, onRerun: vi.fn() })))
}
const pillStatus = () => host.querySelector('[data-testid="status-pill"]')?.getAttribute('data-status')

describe('FixReviewSummary', () => {
  it('draws the verdict as a status pill', () => {
    render(base)
    expect(pillStatus()).toBe('passed')
    render({ ...base, state: 'hold', label: 'Hold', verdict: 'hold' })
    expect(pillStatus()).toBe('failed')
    render({ ...base, state: 'fix_first', label: 'Fix first', verdict: 'fix_first' })
    expect(pillStatus()).toBe('slow')
    render({ ...base, state: 'queued', label: 'Reviewing', verdict: null })
    expect(pillStatus()).toBe('running')
    render({ ...base, state: 'not_reviewed', label: 'Not reviewed', verdict: null })
    expect(pillStatus()).toBe('idle')
  })

  it('gives each finding its severity shape and grades vitals in the summary', () => {
    render({
      ...base,
      state: 'fix_first',
      verdict: 'fix_first',
      summary: 'The change pushes LCP 6408ms on the home page',
      findings: [
        { severity: 'blocker', file: 'a.ts', line: 3, issue: 'Drops the guard', suggested_fix: '' },
        { severity: 'major', file: 'b.ts', line: null, issue: 'No test', suggested_fix: '' },
      ],
    } as FixReview)
    const severities = [...host.querySelectorAll('[data-severity]')]
    expect(severities.map((s) => s.getAttribute('data-severity'))).toEqual(['blocker', 'major'])
    expect(severities.every((s) => s.querySelector('svg'))).toBe(true)
    expect(host.querySelector('[data-testid="vital-LCP"]')).not.toBeNull()
  })
})
