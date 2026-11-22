/**
 * @vitest-environment jsdom
 *
 * /fixes (console polish 2026-11-22): the page loads up to 200 attempts per request and drew
 * all 200 rows at once. The table now draws the first 50, adds 50 per "Show more", has
 * "Show all", and always draws a row a deep link opened.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))

import { FixesTable, fixRowsToDraw } from './FixesTable'
import type { FixAttempt } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const fix = (n: number): FixAttempt =>
  ({
    id: `f${n}`,
    report_id: `r${n}`,
    agent: 'cursor_cloud',
    status: 'failed',
    started_at: '2026-11-20T09:00:00Z',
    report_fix_state: 'failed',
    is_latest_attempt: true,
    retryable: true,
    error: 'Cursor API error 500: upstream',
    report_title: `Bug ${n}`,
  }) as FixAttempt

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(count: number, expandedId: string | null = null) {
  const fixes = Array.from({ length: count }, (_, i) => fix(i + 1))
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(FixesTable, {
          fixes,
          expandedId,
          timelines: {},
          traceUrlFor: () => null,
          inFlightReportIds: new Set<string>(),
          inventoryActions: {},
          onToggle: vi.fn(),
          onRetry: vi.fn(),
        }),
      ),
    )
  })
}

/** Attempt rows only: each one names its report. */
const rowCount = () => [...host.querySelectorAll('tbody tr')].filter((tr) => /Bug \d+/.test(tr.textContent ?? '')).length
const button = (text: RegExp) => [...host.querySelectorAll('button')].find((b) => text.test(b.textContent ?? '')) as HTMLButtonElement | undefined

describe('fixRowsToDraw', () => {
  it('draws the requested rows, stretched to the expanded row, never past the list', () => {
    expect(fixRowsToDraw(200, 50, -1)).toBe(50)
    expect(fixRowsToDraw(30, 50, -1)).toBe(30)
    expect(fixRowsToDraw(200, 50, 149)).toBe(150)
    expect(fixRowsToDraw(200, 50, 10)).toBe(50)
  })
})

describe('FixesTable progressive rows', () => {
  it('draws the first 50 of 200, then 50 more per "Show more", then all', () => {
    render(200)
    expect(rowCount()).toBe(50)
    expect(host.querySelector('[data-testid="fixes-table-more"]')?.textContent).toContain('Showing 50 of 200 attempts')
    act(() => button(/^Show 50 more$/)!.click())
    expect(rowCount()).toBe(100)
    act(() => button(/^Show all 200$/)!.click())
    expect(rowCount()).toBe(200)
    expect(host.querySelector('[data-testid="fixes-table-more"]')).toBeNull()
  })

  it('offers only what is left, with 44 px buttons on touch', () => {
    render(70)
    const more = button(/^Show 20 more$/)!
    expect(more.className).toContain('pointer-coarse:min-h-11')
    expect(button(/^Show all/)).toBeUndefined()
  })

  it('shows every row and no "Show more" for a short list', () => {
    render(12)
    expect(rowCount()).toBe(12)
    expect(host.querySelector('[data-testid="fixes-table-more"]')).toBeNull()
  })

  it('draws a deep-linked row even when it sits past the first 50', () => {
    render(200, 'f120')
    expect(rowCount()).toBe(120)
    expect(host.textContent).toContain('Bug 120')
  })
})
