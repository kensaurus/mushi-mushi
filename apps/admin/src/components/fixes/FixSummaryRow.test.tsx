/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/fixes/FixSummaryRow.test.tsx
 * PURPOSE: The failed total's subtitle names one cause only when that cause
 *          is the only one. Several causes stay mixed, and the list of
 *          causes is not labelled as a single "PR closed without merge".
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FixSummaryRow } from './FixSummaryRow'
import type { FixSummary } from './types'

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
function tileText(label: string): string {
  const labelEl = [...host.querySelectorAll('div')].find(
    (el) => el.className.includes('uppercase') && el.textContent === label,
  )
  return labelEl?.parentElement?.parentElement?.parentElement?.textContent ?? ''
}

describe('FixSummaryRow failed subtitle', () => {
  it('does not call the whole failed total one cause when several causes are present', () => {
    render(summary({
      failureBreakdown: [
        { category: 'pr_closed_unmerged', count: 3 },
        { category: 'ci_failed', count: 1 },
      ],
    }))
    expect(tileText('Auto-fix stopped')).toContain('several causes')
    expect(tileText('Auto-fix stopped')).not.toContain('PR closed without merge')
    expect(tileText('Why auto-fix stopped')).toContain('several causes')
    expect(tileText('Why auto-fix stopped')).not.toContain('PR closed without merge')
  })

  it('names the cause when every stopped report failed that way', () => {
    render(summary({
      failed: 2,
      total: 2,
      failureBreakdown: [{ category: 'pr_closed_unmerged', count: 2 }],
    }))
    expect(tileText('Why auto-fix stopped')).toContain('PR closed without merge')
    expect(tileText('Why auto-fix stopped')).not.toContain('several causes')
  })
})
