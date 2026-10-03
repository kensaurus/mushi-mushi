/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/design/DevianceScoreCard.test.tsx
 * PURPOSE: An unscored deviance run reads "Not scored" with a reason — never
 *          0, which would claim a perfectly on-system codebase. A real 0 is
 *          still shown as 0.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DevianceRun } from '../../lib/recipeTypes'
import { DevianceScoreCard } from './DevianceScoreCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function run(overrides: Partial<DevianceRun>): DevianceRun {
  return {
    runId: 'run-1',
    status: 'pass',
    score: 12,
    scannedFiles: 40,
    scannedLines: 5000,
    matchedFiles: 40,
    truncated: false,
    commitSha: 'abcdef1234567',
    startedAt: '2026-10-01T00:00:00Z',
    completedAt: '2026-10-01T00:00:30Z',
    breakdown: [],
    counts: {},
    storedFindings: 3,
    error: null,
    ...overrides,
  }
}

describe('DevianceScoreCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(r: DevianceRun | null) {
    act(() => {
      root.render(createElement(DevianceScoreCard, { run: r }))
    })
  }

  it('renders score: null as "Not scored" with the reason, not 0', () => {
    render(run({ score: null, scannedFiles: 0, matchedFiles: 0 }))
    const score = container.querySelector('[data-testid="deviance-score"]')
    expect(score?.textContent).toContain('Not scored')
    expect(score?.textContent).toContain('matched no files')
    expect(score?.textContent).not.toMatch(/\b0\b/)
  })

  it('renders "Not scored" when there is no run at all', () => {
    render(null)
    expect(container.querySelector('[data-testid="deviance-score"]')?.textContent).toContain('Not scored')
  })

  it('still shows a genuine 0 as 0', () => {
    render(run({ score: 0 }))
    const score = container.querySelector('[data-testid="deviance-score"]')
    expect(score?.textContent).toContain('0')
    expect(score?.textContent).not.toContain('Not scored')
  })

  it('warns when the scan was truncated', () => {
    render(run({ truncated: true }))
    expect(container.textContent).toContain('Partial scan')
  })
})
