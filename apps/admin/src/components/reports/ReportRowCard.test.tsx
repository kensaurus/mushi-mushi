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

  // Console UX pass 2026-11-22: the checkbox and the one action were 14–20px on a phone.
  it('gives the checkbox and the action 44px tap targets', async () => {
    await render([row('a'), row('c', { status: 'classified' })])
    const a = container.querySelector('[data-testid="report-card-a"]')!
    expect(a.querySelector('label')!.className).toContain('h-11 w-11')
    expect(a.querySelector('label input[type="checkbox"]')).toBeTruthy()
    const triage = [...a.querySelectorAll('a')].find((el) => el.textContent === 'Triage →')!
    expect(triage.className).toContain('min-h-11')
    const fix = [...container.querySelectorAll('[data-testid="report-card-c"] button')].find((el) => el.textContent === 'Fix →')!
    expect(fix.className).toContain('min-h-11')
  })

  it('draws the stripe on the severity ramp: medium yellow, low never green', () => {
    expect(severityStripeClass('medium')).toBe('bg-sev-medium')
    expect(severityStripeClass('low')).not.toMatch(/bg-ok|bg-brand/)
    expect(severityStripeClass('critical')).toBe('bg-danger')
  })
})

// Console UX pass 2026-11-22: "Conf." read 95–100% on nearly every row, and
// the hint "scroll for status & actions" hid the row's actions behind a scroll.
describe('Bugs list confidence and actions', () => {
  it('has no confidence column; only a score under 80% shows, as a worded chip', async () => {
    await render([row('hi', { confidence: 0.97 }), row('edge', { confidence: 0.8 }), row('lo', { confidence: 0.62 }), row('none', { confidence: null })])
    const head = container.querySelector('thead')!.textContent ?? ''
    expect(head).not.toContain('Conf')
    expect(container.querySelectorAll('colgroup col')).toHaveLength(6)
    expect(container.querySelectorAll('tbody tr')[2].querySelector('[data-testid="low-confidence-chip"]')?.textContent).toBe('Low confidence · 62%')
    expect(container.querySelector('[data-testid="report-card-lo"] [data-testid="low-confidence-chip"]')?.textContent).toBe('Low confidence · 62%')
    for (const id of ['hi', 'edge', 'none']) {
      expect(container.querySelector(`[data-testid="report-card-${id}"] [data-testid="low-confidence-chip"]`)).toBeNull()
    }
    // One chip in the table row and one in the phone card, for "lo" only.
    expect(container.querySelectorAll('[data-testid="low-confidence-chip"]')).toHaveLength(2)
  })

  it('labels the status in the table row and drops the "scroll for" hint', async () => {
    await render([row('c', { status: 'classified' })])
    const tr = container.querySelector('tbody tr')!
    expect(tr.querySelector('[data-testid="status-stepper-word"]')?.textContent).toBe('Classified')
    expect(tr.querySelector('[data-testid="status-stepper-step"]')?.textContent).toBe('2 of 4')
    expect(container.textContent).not.toContain('scroll for')
    expect(container.textContent).toContain('Click a row to open it')
  })

  it("lets touch reach the row's More menu", async () => {
    await render([row('a')])
    const reveal = container.querySelector('tbody tr .row-kebab-reveal')!
    expect(reveal.className).toContain('group-focus-within:pointer-events-auto')
    expect(reveal.className).toContain('pointer-coarse:pointer-events-auto')
    expect(reveal.querySelector('[data-testid="report-row-more"]')).toBeTruthy()
  })
})

// Console polish 2026-11-22: copy link, new tab and dismiss were three ~20 px icons on a
// touch tablet. They sit behind one "More" menu with 44 px targets on coarse pointers.
describe('Bugs list row More menu', () => {
  const raf = () => act(async () => { await new Promise((r) => setTimeout(r, 40)) })

  it('replaces the three icons with one 44 px More trigger', async () => {
    await render([row('a')])
    const tr = container.querySelector('tbody tr')!
    expect(tr.querySelector('[aria-label="Dismiss"]')).toBeNull()
    expect(tr.querySelector('[aria-label="Copy link"]')).toBeNull()
    const more = tr.querySelector<HTMLButtonElement>('[data-testid="report-row-more"]')!
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.getAttribute('aria-label')).toMatch(/copy link, open in new tab, dismiss/)
    expect(more.className).toContain('pointer-coarse:h-11')
    expect(more.className).toContain('pointer-coarse:w-11')
  })

  it('opens a menu of 44 px items that copy, open in a new tab and dismiss, without opening the row', async () => {
    const onOpen = vi.fn()
    const onCopyLink = vi.fn()
    const onDismiss = vi.fn()
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(ReportsTable, {
            reports: [row('a')], total: 1, page: 0, totalPages: 1, sort: 'created_at', dir: 'desc',
            selected: new Set<string>(), cursor: 0, allSelected: false, someSelected: false,
            dispatching: new Set<string>(), groupCollapse: false, expandedGroups: new Set<string>(),
            onToggleGroup: vi.fn(), onToggleSelectAll: vi.fn(), onToggleSelect: vi.fn(), onSetSort: vi.fn(),
            onSetCursor: vi.fn(), onSetPage: vi.fn(), onOpen, onCopyLink, onDismiss, onDispatchFix: vi.fn(),
          }),
        ),
      )
    })
    const more = container.querySelector<HTMLButtonElement>('tbody tr [data-testid="report-row-more"]')!
    await act(async () => more.click())
    await raf()
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const menu = document.querySelector<HTMLElement>('[data-testid="report-row-more-menu"]')!
    expect(menu.getAttribute('role')).toBe('menu')
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items.map((i) => i.textContent)).toEqual(['Copy link', 'Open in new tab', 'Dismiss'])
    for (const i of items) expect(i.className).toContain('pointer-coarse:min-h-11')
    expect(items[1].getAttribute('href')).toContain('/reports/a')
    expect(items[1].getAttribute('target')).toBe('_blank')
    // Keyboard: focus starts on the first item; arrows move; Escape closes.
    expect(document.activeElement).toBe(items[0])
    await act(async () => { items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement).toBe(items[1])
    await act(async () => { items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    expect(document.activeElement).toBe(items[0])
    await act(async () => items[0].click())
    expect(onCopyLink).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-testid="report-row-more-menu"]')).toBeNull()

    await act(async () => more.click())
    await raf()
    const dismiss = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="report-row-more-menu"] [role="menuitem"]')).find((i) => i.textContent === 'Dismiss')!
    await act(async () => dismiss.click())
    expect(onDismiss).toHaveBeenCalledTimes(1)
    // Neither the trigger nor a menu item opens the report underneath.
    expect(onOpen).not.toHaveBeenCalled()

    await act(async () => more.click())
    await raf()
    const first = document.querySelector<HTMLElement>('[data-testid="report-row-more-menu"] [role="menuitem"]')!
    await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[data-testid="report-row-more-menu"]')).toBeNull()
  })
})
