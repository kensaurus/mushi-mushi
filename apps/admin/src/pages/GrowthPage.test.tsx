/**
 * @vitest-environment jsdom
 */

/**
 * Growth read the funnel's weeks as oldest first while the endpoint sends
 * them newest first (round-2 sweep 2026-11-18): the tiles showed the oldest
 * week ("Signups 0, week of Sep 28"), the chart ran "Nov 16 … Sep 28", and
 * drop-offs were red. Normal attrition is neutral; all-zero columns and an
 * empty 0–0 chart are not drawn.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const data = vi.hoisted(() => ({ byPath: {} as Record<string, { data?: unknown; error?: string; errorCode?: string }> }))

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const hit = path ? Object.entries(data.byPath).find(([p]) => path.startsWith(p))?.[1] : undefined
    return {
      data: hit?.data ?? null,
      loading: false,
      error: hit?.error ?? null,
      errorCode: hit?.errorCode ?? null,
      reload: vi.fn(),
      lastFetchedAt: null,
      isValidating: false,
    }
  },
}))
vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => ({ isOperator: true, loading: false }) }))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title }: { title: string }) => createElement('h1', null, title),
}))

import { GrowthPage } from './GrowthPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const week = (week_start: string, over: Record<string, number> = {}) => ({
  week_start, visits: 0, signups: 0, projects: 0, keys: 0, sdk_installed: 0, activated: 0, fix_pulled: 0, habit: 0, paid: 0, ...over,
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(GrowthPage)))
  })
  return container.textContent ?? ''
}

describe('GrowthPage', () => {
  it('reads the current week from a newest-first response and draws attrition neutral', async () => {
    data.byPath = {
      '/v1/admin/growth/funnel': {
        data: {
          // Newest first, as company_funnel_weekly returns it.
          weeks: [week('2026-11-16', { visits: 19, signups: 1 }), week('2026-11-09', { visits: 88, signups: 2, projects: 1 }), week('2026-09-28', { signups: 7 })],
          by_source: [{ source: 'unknown', signups: 10, activated: 0 }],
          generated_at: '2026-11-18T13:27:15Z',
        },
      },
      '/v1/admin/growth/daily': { data: { days: [], by_src: [] } },
    }
    const text = await render()
    const shortNov16 = new Date(Date.UTC(2026, 10, 16)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    expect(text).toContain(`week of ${shortNov16}`)
    // The newest week heads the table.
    const firstRow = container.querySelector('tbody tr')!
    expect(firstRow.textContent).toContain(shortNov16)
    // Empty chart: one line, no 0–0 axes.
    expect(container.querySelector('[data-testid="growth-activated-empty"]')).toBeTruthy()
    // All-zero stages are not columns.
    const heads = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)
    expect(heads).toContain('Signups')
    expect(heads).not.toContain('Paid')
    expect(heads).not.toContain('Habit')
    // Drop-off is neutral, never red.
    expect(container.querySelector('tbody .text-danger, tbody .text-warn')).toBeNull()
    expect(text).toContain('Signups (3 wk)')
  })

  it('says the daily scorecard was not checked when its read timed out', async () => {
    data.byPath = {
      '/v1/admin/growth/funnel': { data: { weeks: [], by_source: [], generated_at: '2026-11-18T13:27:15Z' } },
      '/v1/admin/growth/daily': { error: 'The server took too long to answer.', errorCode: 'TIMEOUT' },
    }
    await render()
    expect(container.querySelector('[data-testid="scorecard-not-checked"]')!.textContent).toContain('not checked')
  })
})
