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
  deps: [] as unknown[][],
}))

vi.mock('../../lib/usePageData', () => ({
  usePageData: (_path: string, opts: { deps?: unknown[] } = {}) => {
    state.deps.push(opts.deps ?? [])
    return {
      data: {
        window_days: 14,
        bySeverity: { critical: 5, high: 0, medium: 0, low: 0 },
        openBySeverity: { critical: 5, high: 0, medium: 0, low: 0 },
        total: 5,
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

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  state.byDayCapped = true
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

  // The Open chip under these tiles means "waiting on a decision"; "Critical ·
  // open" read as the same word for a different count (2026-10-28).
  it("names what the tile counts without reusing the Open chip's word", async () => {
    await render()
    expect(host.textContent).toContain('Critical · not fixed')
    expect(host.textContent).not.toMatch(/· open/i)
  })

  it('draws the sparkline when the scan is complete', async () => {
    state.byDayCapped = false
    await render('project')
    expect(host.querySelector('[data-testid="reports-kpi-trend-cap"]')).toBeNull()
    expect(host.querySelector('svg')).not.toBeNull()
  })
})
