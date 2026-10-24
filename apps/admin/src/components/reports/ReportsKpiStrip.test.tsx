/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/reports/ReportsKpiStrip.test.tsx
 * PURPOSE: Severity tiles keep their loaded height while the stats request
 *          is in flight, so the sparkline cannot push the queue down.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REPORTS_KPI_TILE_MIN_HEIGHT } from './ReportsKpiStrip'

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: null, loading: true, error: null, reload: () => {} }),
}))

import { ReportsKpiStrip } from './ReportsKpiStrip'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ReportsKpiStrip', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('reserves the loaded tile height while severity stats are loading', () => {
    act(() => {
      root.render(createElement(ReportsKpiStrip, { onFilter: () => {} }))
    })
    const tiles = container.querySelectorAll('button')
    expect(tiles.length).toBe(4)
    for (const tile of tiles) {
      expect(tile.className).toContain(REPORTS_KPI_TILE_MIN_HEIGHT)
    }
  })
})
