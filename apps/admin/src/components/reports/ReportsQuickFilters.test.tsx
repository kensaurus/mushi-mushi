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
