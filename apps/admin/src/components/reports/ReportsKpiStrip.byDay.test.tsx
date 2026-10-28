/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/reports/ReportsKpiStrip.byDay.test.tsx
 * PURPOSE: When All apps outgrows the day scan, the tiles stay and the
 *          sparkline is hidden so the two cannot disagree.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  byDayCapped: true,
  filed: 5,
  open: 5,
  deps: [] as unknown[][],
}))

vi.mock('../../lib/usePageData', () => ({
  usePageData: (_path: string, opts: { deps?: unknown[] } = {}) => {
    state.deps.push(opts.deps ?? [])
    return {
      data: {
        window_days: 14,
        bySeverity: { critical: state.filed, high: 0, medium: 0, low: 0 },
        openBySeverity: { critical: state.open, high: 0, medium: 0, low: 0 },
        total: state.filed,
        byDay: [
          { day: '2026-10-23', critical: 4, high: 0, medium: 0, low: 0, total: 4 },
          { day: '2026-10-24', critical: 1, high: 0, medium: 0, low: 0, total: 1 },
        ],
        byDayCapped: state.byDayCapped,
      },
      loading: false,
      error: null,
      reload: () => {},
    }
  },
}))

import { ReportsKpiStrip } from './ReportsKpiStrip'
import { criticalTileLabel } from '../../lib/criticalSurfaces'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  state.byDayCapped = true
  state.filed = 5
  state.open = 5
  state.deps = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(scope: 'enumeration' | 'project' = 'enumeration') {
  await act(async () => {
    root.render(createElement(ReportsKpiStrip, { scope, onFilter: () => {}, windowDays: 14 }))
  })
}

describe('ReportsKpiStrip capped trend', () => {
  it('keeps the exact count and hides a sparkline that would not add up', async () => {
    await render()
    expect(host.textContent).toContain('5')
    expect(host.querySelector('[data-testid="reports-kpi-trend-cap"]')?.textContent).toMatch(/hidden/)
    expect(host.querySelector('svg')).toBeNull()
    expect(state.deps.some((deps) => deps.includes('enumeration'))).toBe(true)
  })

  it('names the 14-day still-open count and describes it with what was filed', async () => {
    state.byDayCapped = false
    state.filed = 10
    state.open = 4
    await render('project')
    expect(host.textContent).toContain(criticalTileLabel('Critical', 14))
    expect(host.textContent).toContain('of 10 filed in 14d · 6 closed')
    expect(host.textContent).not.toContain('not yet triaged')
  })

  it('draws the sparkline when the scan is complete', async () => {
    state.byDayCapped = false
    await render('project')
    expect(host.querySelector('[data-testid="reports-kpi-trend-cap"]')).toBeNull()
    expect(host.querySelector('svg')).not.toBeNull()
  })
})
