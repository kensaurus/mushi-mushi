/**
 * @vitest-environment jsdom
 *
 * FILE: reportsHitTargets.test.tsx
 * PURPOSE: Sort, select-all, and the filter-chip remove stay on screen and
 *          use the 24px hit class. The stacked-card attempt hid the header.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@formkit/auto-animate/react', () => ({
  useAutoAnimate: () => [() => undefined],
}))
vi.mock('../ProjectSwitcher', () => ({ useActiveProjectId: () => '11111111-1111-4111-8111-111111111111' }))

import { ActiveFiltersRail } from '../ActiveFiltersRail'
import { ReportsTable } from './ReportsTable'
import { SortHeader } from './SortHeader'
import type { ReportRow } from './types'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ROW = {
  id: 'c0e99783-a48f-43bf-9fd9-84708dec1a3c',
  project_id: '11111111-1111-4111-8111-111111111111',
  description: 'Checkout button does nothing',
  category: 'bug',
  severity: 'high',
  summary: 'Pay button dead',
  status: 'new',
  created_at: '2026-10-02T10:00:00Z',
  user_category: 'bug',
  confidence: 0.9,
  component: null,
} as ReportRow

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  if (!('ResizeObserver' in globalThis)) {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('reports header stays usable', () => {
  it('keeps select-all and the sort buttons, each at least the 24px class', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(ReportsTable, {
            reports: [ROW],
            total: 1,
            page: 0,
            totalPages: 1,
            sort: 'severity',
            dir: 'desc',
            selected: new Set<string>(),
            cursor: 0,
            allSelected: false,
            someSelected: false,
            dispatching: new Set<string>(),
            groupCollapse: false,
            expandedGroups: new Set<string>(),
            onToggleGroup: vi.fn(),
            onToggleSelectAll: vi.fn(),
            onToggleSelect: vi.fn(),
            onSetSort: vi.fn(),
            onSetCursor: vi.fn(),
            onSetPage: vi.fn(),
            onOpen: vi.fn(),
            onCopyLink: vi.fn(),
            onDismiss: vi.fn(),
            onDispatchFix: vi.fn(),
          }),
        ),
      )
    })
    const selectAll = container.querySelector<HTMLInputElement>('input[aria-label="Select all on page"]')
    expect(selectAll).not.toBeNull()
    expect(selectAll!.className).toContain('size-6')
    const sort = container.querySelector<HTMLButtonElement>('button[aria-label="Sort by Severity"]')
    expect(sort).not.toBeNull()
    expect(sort!.className).toContain('min-h-6')
    expect(container.textContent).toContain('Severity')
  })

  it('gives a sort header a 24px-tall button that still names the column', async () => {
    await act(async () => {
      root.render(
        createElement(
          'table',
          null,
          createElement(
            'thead',
            null,
            createElement('tr', null, createElement(SortHeader, {
              label: 'Severity',
              field: 'severity',
              current: 'created_at',
              dir: 'desc',
              onSort: vi.fn(),
            })),
          ),
        ),
      )
    })
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Sort by Severity')
    expect(button?.className).toContain('min-h-6')
    expect(button?.className).toContain('overflow-hidden')
  })

  it('sizes the filter-chip remove control to 24px', async () => {
    await act(async () => {
      root.render(
        createElement(ActiveFiltersRail, {
          filters: [{ key: 'severity', label: 'Severity', value: 'high', onClear: vi.fn() }],
        }),
      )
    })
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="Remove Severity filter"]')
    expect(remove?.className).toContain('size-6')
  })
})
