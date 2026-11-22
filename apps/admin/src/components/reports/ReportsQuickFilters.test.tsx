/**
 * FILE: apps/admin/src/components/reports/ReportsQuickFilters.test.tsx
 * PURPOSE: The reports quick-filter rail keeps its status/severity divider
 *          from wrapping onto its own line at phone width.
 *
 * OVERVIEW:
 * - Renders the chip toolbar to static markup
 * - Asserts the two chip groups stack below sm and the divider stays
 *   inside the severity group, hidden until sm
 *
 * DEPENDENCIES:
 * - react-dom/server renderToStaticMarkup
 * - ReportsQuickFilters
 *
 * USAGE:
 * - vitest include src/**\/*.test.tsx
 *
 * NOTES:
 * - Markup only. Counts load in an effect, so this does not hit the API.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ReportsQuickFilters } from './ReportsQuickFilters'
import { ReportsFilterBar } from './ReportsFilterBar'

describe('ReportsQuickFilters divider', () => {
  it('stacks the chip groups and hides the divider below sm', () => {
    const html = renderToStaticMarkup(
      <ReportsQuickFilters status="" severity="" onSetFilter={vi.fn()} />,
    )

    const toolbarAt = html.indexOf('role="toolbar"')
    const toolbar = html.slice(Math.max(0, toolbarAt - 500), toolbarAt)
    expect(toolbar).toContain('flex-col')
    expect(toolbar).toContain('sm:flex-row')
    expect(toolbar).not.toContain('flex-wrap')

    const severityAt = html.indexOf('aria-label="Severity filters"')
    const dividerAt = html.indexOf('w-px')
    const criticalAt = html.indexOf('>Critical<')
    expect(severityAt).toBeGreaterThan(-1)
    expect(dividerAt).toBeGreaterThan(severityAt)
    expect(criticalAt).toBeGreaterThan(dividerAt)

    const divider = html.slice(dividerAt - 120, dividerAt + 40)
    expect(divider).toContain('hidden')
    expect(divider).toContain('sm:inline-block')
  })
})

// Owner 2026-11-18: the chips and the search/select bar were two filter rows.
// They are one row now: the chips lead the bar, with no sticky box of their own.
describe('one filter row', () => {
  it('puts the status and severity chips in the same row as search and the selects', () => {
    const html = renderToStaticMarkup(
      <ReportsFilterBar
        searchInput=""
        onSearchInputChange={vi.fn()}
        searchInputRef={{ current: null }}
        status=""
        category=""
        severity=""
        contextChips={[]}
        hasFilters={false}
        onSetFilter={vi.fn()}
        onClearAll={vi.fn()}
        quickFilters={<ReportsQuickFilters status="" severity="" onSetFilter={vi.fn()} inline />}
      />,
    )
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const row = doc.querySelector('[data-testid="reports-filter-row"]')!
    expect(row.querySelector('[role="toolbar"][aria-label="Quick filters"]')).not.toBeNull()
    expect(row.querySelector('input[type="search"]')).not.toBeNull()
    expect(row.querySelector('select[aria-label="Filter by platform"]')).not.toBeNull()
    // The inline chips carry no sticky box; the row is the one sticky bar.
    expect(row.querySelector('[role="toolbar"]')!.className).not.toContain('sticky')
    expect(row.className).toContain('lg:sticky')
    // "Any status:" still says the severity counts include fixed bugs.
    expect(row.textContent).toContain('Any status:')
  })
})
