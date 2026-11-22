/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/reports/ReportRowCard.test.tsx
 * PURPOSE: Fresh-eyes sweep 2026-11-18, /reports at 390px: the table scrolled
 *          sideways, so titles were cut and status, severity and the action
 *          sat off-screen. On a phone each report is a stacked row with its
 *          status word, severity, age and one action inline; the pager stays
 *          on one line; the age column has a header; low rows are not green.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))
vi.mock('../ProjectSwitcher', () => ({ useActiveProjectId: () => '11111111-1111-4111-8111-111111111111' }))

import { ReportsTable } from './ReportsTable'
import { severityStripeClass, type ReportRow } from './types'

const row = (id: string, over: Partial<ReportRow> = {}) =>
  ({
    id,
    project_id: '11111111-1111-4111-8111-111111111111',
    description: `Bug ${id}`,
    category: 'bug',
    severity: 'medium',
    summary: `Summary ${id}`,
    status: 'new',
    created_at: '2026-11-18T10:00:00Z',
    user_category: 'bug',
    confidence: 0.9,
    component: null,
    ...over,
  }) as ReportRow

// jsdom has no ResizeObserver; ResponsiveTable measures its scroll shadow with one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(reports: ReportRow[]) {
  const noop = vi.fn()
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(ReportsTable, {
          reports,
          total: 2138,
          page: 0,
          totalPages: 43,
          sort: 'created_at',
          dir: 'desc',
          selected: new Set<string>(),
          cursor: 0,
          allSelected: false,
          someSelected: false,
          dispatching: new Set<string>(),
          groupCollapse: false,
          expandedGroups: new Set<string>(),
          onToggleGroup: noop,
          onToggleSelectAll: noop,
          onToggleSelect: noop,
          onSetSort: noop,
          onSetCursor: noop,
          onSetPage: noop,
          onOpen: noop,
          onCopyLink: noop,
          onDismiss: noop,
          onDispatchFix: noop,
        }),
      ),
    )
  })
}

describe('Bugs list on a phone', () => {
  it('renders one stacked row per report, hidden from sm up, with status, severity and an action', async () => {
    await render([row('a'), row('b', { status: 'dismissed', severity: 'low' })])
    const list = container.querySelector('[data-testid="reports-card-list"]')!
    expect(list.className).toContain('sm:hidden')
    const a = list.querySelector('[data-testid="report-card-a"]')!
    expect(a.textContent).toContain('Summary a')
    expect(a.querySelector('[data-testid="status-stepper-word"]')?.textContent).toBe('Received')
    expect(a.querySelector('[aria-label="Severity Medium"]')).toBeTruthy()
    expect(a.textContent).toContain('Triage →')
    // A dismissed row says so in words, not a bare ⊘.
    expect(list.querySelector('[data-testid="report-card-b"] [data-testid="status-stepper-word"]')?.textContent).toBe('Dismissed')
    // The wide table is still there from sm up.
    expect(container.querySelector('table')!.closest('.hidden.sm\\:block')).toBeTruthy()
  })

  it('keeps the pager on one line and names the age column', async () => {
    await render([row('a')])
    expect(container.querySelector('[data-testid="reports-pager"]')!.className).toContain('whitespace-nowrap')
    expect(container.querySelector('thead')!.textContent).toContain('Action · age')
  })

  it('draws the stripe on the severity ramp: medium yellow, low never green', () => {
    expect(severityStripeClass('medium')).toBe('bg-sev-medium')
    expect(severityStripeClass('low')).not.toMatch(/bg-ok|bg-brand/)
    expect(severityStripeClass('critical')).toBe('bg-danger')
  })
})
