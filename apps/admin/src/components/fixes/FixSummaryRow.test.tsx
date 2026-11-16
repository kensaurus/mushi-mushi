/**
 * @vitest-environment jsdom
 */

/**
 * "Auto-fix stopped" is reports still unfixed. "Why auto-fix stopped" names
 * one cause only when that cause is the only one. With several causes its
 * number is the full unfixed total, the subtitle lists each cause's count,
 * and it does not call the whole pile "PR closed without merge".
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

/** The KPI card that shows `label`: its numeral, subtitle, and info tip. */
function tile(label: string): { value: string; sublabel: string; detail: string } {
  const labelEl = [...host.querySelectorAll('div')].find(
    (el) => el.textContent === label && el.className.includes('uppercase'),
  )
  expect(labelEl, label).toBeTruthy()
  const root = labelEl?.parentElement?.parentElement?.parentElement
  const value = root?.querySelector('.tabular-nums')?.textContent ?? ''
  const sublabel = [...(root?.querySelectorAll('span') ?? [])].find((s) => s.className.includes('truncate'))?.textContent ?? ''
  const detail = root?.querySelector('[role="img"]')?.getAttribute('aria-label') ?? ''
  return { value, sublabel, detail }
}

describe('FixSummaryRow failed subtitle', () => {
  it('keeps the unfixed total when several causes exist, and lists each count', () => {
    render(summary({
      failed: 35,
      total: 35,
      failureBreakdown: [
        { category: 'pr_closed_unmerged', count: 18 },
        { category: 'ci_failed', count: 15 },
        { category: 'unknown', count: 2 },
      ],
    }))
    const stopped = tile('Auto-fix stopped')
    expect(stopped.value).toBe('35')
    expect(stopped.sublabel).toBe('reports still unfixed')
    expect(stopped.sublabel).not.toContain('PR closed without merge')

    const why = tile('Why auto-fix stopped')
    expect(why.value).toBe('35')
    expect(why.sublabel).toBe('several causes · 18 + 15 + 2')
    expect(why.sublabel).not.toContain('PR closed without merge')
    expect(why.detail).toContain('18× PR closed without merge')
    expect(why.detail).toContain('15× CI failed')
    expect(why.detail).toContain('2× Unrecognised error')
  })

  it('names the cause and its count when every stopped report failed that way', () => {
    render(summary({
      failed: 9,
      total: 9,
      failureBreakdown: [{ category: 'pr_closed_unmerged', count: 2 }],
    }))
    const stopped = tile('Auto-fix stopped')
    expect(stopped.value).toBe('9')
    expect(stopped.sublabel).toBe('reports still unfixed')

    const why = tile('Why auto-fix stopped')
    expect(why.value).toBe('2')
    expect(why.sublabel).toBe('PR closed without merge')
    expect(why.sublabel).not.toContain('several causes')
  })

  it('keeps the In flight subtitle as queued or running', () => {
    render(summary({ inProgress: 1, failed: 0 }))
    const inflight = tile('In flight')
    expect(inflight.value).toBe('1')
    expect(inflight.sublabel).toBe('queued or running')
    expect(inflight.sublabel).not.toContain('still running')
  })
})
