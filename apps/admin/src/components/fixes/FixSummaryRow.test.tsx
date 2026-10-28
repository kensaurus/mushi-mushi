/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/fixes/FixSummaryRow.test.tsx
 * PURPOSE: "Auto-fix stopped" always means reports still unfixed. The
 *          "Why auto-fix stopped" tile names one cause only when that cause
 *          is the only one; with several causes its number is the full
 *          unfixed total, not the most common cause's count.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FixSummaryRow } from './FixSummaryRow'
import type { FixSummary } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function summary(over: Partial<FixSummary>): FixSummary {
  return {
    total: 4,
    completed: 0,
    failed: 4,
    inProgress: 0,
    prsOpen: 0,
    prsCiPassing: 0,
    days: [],
    ...over,
  }
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

function render(data: FixSummary) {
  act(() => {
    root.render(createElement(FixSummaryRow, { summary: data, successRate: null }))
  })
}

/** The KPI card that shows `label`, including its number and subtitle. */
const TILE_TEST_ID: Record<string, string> = {
  'Auto-fix stopped': 'kpi-auto-fix-stopped',
  'Why auto-fix stopped': 'kpi-why-auto-fix-stopped',
}

function tileText(label: string): string {
  const el = host.querySelector(`[data-testid="${TILE_TEST_ID[label]}"]`)
  expect(el, label).not.toBeNull()
  return el?.textContent ?? ''
}

describe('FixSummaryRow failed subtitle', () => {
  it('keeps the unfixed total when several causes exist, and does not show only the top cause', () => {
    render(summary({
      failed: 20,
      total: 20,
      failureBreakdown: [
        { category: 'pr_closed_unmerged', count: 17 },
        { category: 'ci_failed', count: 3 },
      ],
    }))
    const stopped = tileText('Auto-fix stopped')
    expect(stopped).toContain('20')
    expect(stopped).toContain('reports still unfixed')
    expect(stopped).not.toContain('several causes')
    expect(stopped).not.toContain('PR closed without merge')

    const why = tileText('Why auto-fix stopped')
    expect(why).toContain('20')
    expect(why).not.toContain('17')
    expect(why).toContain('several causes')
    expect(why).not.toContain('PR closed without merge')
  })

  it('names the cause and its count when every stopped report failed that way', () => {
    render(summary({
      failed: 9,
      total: 9,
      failureBreakdown: [{ category: 'pr_closed_unmerged', count: 2 }],
    }))
    const stopped = tileText('Auto-fix stopped')
    expect(stopped).toContain('9')
    expect(stopped).toContain('reports still unfixed')

    const why = tileText('Why auto-fix stopped')
    expect(why).toContain('2')
    expect(why).not.toContain('9')
    expect(why).toContain('PR closed without merge')
    expect(why).not.toContain('several causes')
  })
})
