/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/reports/ReportsKpiStrip.test.tsx
 * PURPOSE: The critical tile stays hero-sized, and loading and loaded tiles
 *          share one min-height plus a trend row, so stats cannot push the
 *          queue down.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pageData = vi.hoisted(() => ({
  loading: true,
  data: null as {
    window_days: number
    bySeverity: Record<'critical' | 'high' | 'medium' | 'low', number>
    openBySeverity: Record<'critical' | 'high' | 'medium' | 'low', number>
    total: number
    byDay: Array<{ day: string; critical: number; high: number; medium: number; low: number; total: number }>
  } | null,
}))

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({
    data: pageData.data,
    loading: pageData.loading,
    error: null,
    reload: () => {},
    isValidating: false,
    lastFetchedAt: null,
  }),
}))

import { REPORTS_KPI_TILE_MIN_HEIGHT, ReportsKpiStrip } from './ReportsKpiStrip'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LOADED = {
  window_days: 14,
  bySeverity: { critical: 2, high: 3, medium: 1, low: 0 },
  openBySeverity: { critical: 1, high: 2, medium: 1, low: 0 },
  total: 6,
  byDay: [
    { day: '2026-10-01', critical: 1, high: 0, medium: 0, low: 0, total: 1 },
    { day: '2026-10-02', critical: 1, high: 1, medium: 0, low: 0, total: 2 },
  ],
}

describe('ReportsKpiStrip', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    pageData.loading = true
    pageData.data = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render() {
    act(() => {
      root.render(createElement(ReportsKpiStrip, { onFilter: () => {} }))
    })
  }

  function tile(name: string): HTMLButtonElement {
    const found = container.querySelector<HTMLButtonElement>(`button[aria-label*="${name}"]`)
    expect(found, name).not.toBeNull()
    return found!
  }

  function expectReservedHeight() {
    const tiles = container.querySelectorAll('button')
    expect(tiles.length).toBe(4)
    expect(REPORTS_KPI_TILE_MIN_HEIGHT).toMatch(/^min-h-/)
    for (const button of tiles) {
      expect(button.className.split(/\s+/)).toContain(REPORTS_KPI_TILE_MIN_HEIGHT)
      expect(button.querySelector('[data-reports-kpi-trend]')).not.toBeNull()
    }
  }

  it('keeps the critical tile hero-sized before severity stats arrive', () => {
    render()
    expect(tile('Critical').innerHTML).toContain('ring-brand/25')
    expect(tile('High').innerHTML).not.toContain('ring-brand/25')
  })

  it('reserves the same min-height and trend row while loading and after stats arrive', () => {
    render()
    expectReservedHeight()

    pageData.loading = false
    pageData.data = LOADED
    render()
    expectReservedHeight()
    expect(tile('Critical').innerHTML).toContain('ring-brand/25')
    expect(tile('High').innerHTML).not.toContain('ring-brand/25')
  })
})
