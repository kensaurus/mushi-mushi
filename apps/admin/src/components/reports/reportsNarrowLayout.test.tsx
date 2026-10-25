/**
 * @vitest-environment jsdom
 */

/**
 * FILE: reportsNarrowLayout.test.tsx
 * PURPOSE: The /reports triage table stacks under its own minimum width,
 *          and that stack is actually mounted (the classes the CSS targets
 *          are on the rendered table, not only in a stylesheet string).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))
vi.mock('../ProjectSwitcher', () => ({ useActiveProjectId: () => '11111111-1111-4111-8111-111111111111' }))
vi.mock('@formkit/auto-animate/react', () => ({ useAutoAnimate: () => [() => undefined] }))

import { ReportsTable } from './ReportsTable'
import { REPORTS_CHECKBOX, REPORTS_HIT, REPORTS_TABLE_MIN_W } from './reportsTableLayout'
import type { ReportRow } from './types'

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../styles/components.css'),
  'utf8',
)

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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('reports triage narrow layout', () => {
  it('uses one width for the wide-table floor and the stack breakpoint', () => {
    const rem = REPORTS_TABLE_MIN_W.match(/min-w-\[(.+)\]/)?.[1]
    expect(rem).toBe('56.5rem')
    expect(css).toContain('.reports-table-frame')
    expect(css).toContain('container-name: reports-table')
    expect(css).toContain(`@container reports-table (max-width: ${rem})`)
    const block = css.slice(css.indexOf(`@container reports-table (max-width: ${rem})`))
    expect(block).toMatch(/min-width:\s*0/)
    expect(block).toContain('grid-template-areas:')
    expect(block).toContain('white-space: normal')
  })

  it('mounts the frame and the triage table the stack CSS selects', async () => {
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
            sort: 'created_at',
            dir: 'desc',
            selected: new Set<string>(),
            cursor: 0,
            allSelected: false,
            someSelected: false,
            dispatching: new Set<string>(),
            groupCollapse: false,
            expandedGroups: new Set<string>(),
            onToggleGroup: () => {},
            onToggleSelectAll: () => {},
            onToggleSelect: () => {},
            onSetSort: () => {},
            onSetCursor: () => {},
            onSetPage: () => {},
            onOpen: () => {},
            onCopyLink: () => {},
            onDismiss: () => {},
            onDispatchFix: () => {},
          }),
        ),
      )
    })

    const frame = container.querySelector('.reports-table-frame')
    expect(frame).not.toBeNull()
    const table = frame!.querySelector('table.reports-triage-table')
    expect(table).not.toBeNull()
    expect(table!.className).toContain(REPORTS_TABLE_MIN_W)
    expect(table!.getAttribute('role')).toBe('table')

    const row = table!.querySelector('tbody tr')
    expect(row?.getAttribute('role')).toBe('row')
    expect(row?.querySelectorAll('td[role="cell"]').length).toBe(7)

    const hit = REPORTS_HIT.split(' ')
    const triage = Array.from(table!.querySelectorAll('a')).find((a) => a.textContent?.includes('Triage'))
    expect(triage).toBeTruthy()
    for (const token of hit) expect(triage!.className.split(/\s+/)).toContain(token)

    const box = table!.querySelector('tbody input[type="checkbox"]')
    for (const token of REPORTS_CHECKBOX.split(' ')) {
      expect(box?.className.split(/\s+/)).toContain(token)
    }

    const sort = table!.querySelector('thead button')
    for (const token of hit) expect(sort?.className.split(/\s+/)).toContain(token)
  })
})
