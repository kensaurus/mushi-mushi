/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/portfolio/StoreReviewsPanel.test.tsx
 * PURPOSE: Store reviews as reports (gap #23) is off by default: "Pull now"
 *          stays disabled until it is switched on, switching it on PUTs the
 *          setting, and a filed review links to its report.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const P1 = '1000000a-0000-4000-8000-000000000000'
const state = vi.hoisted(() => ({ enabled: false }))
const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), reload: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch, apiFetchMutate: mocks.apiFetch }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({
    data: {
      settings: { enabled: state.enabled, maxRating: 2, lastPulledAt: null, lastStatus: null, lastError: null },
      sources: [{ store: 'app_store', appId: '6761582648', connected: true }],
      recent: [
        { store: 'app_store', reviewId: 'r1', rating: 1, reportId: 'rep-1', reviewCreatedAt: '2026-10-02T08:00:00Z', seenAt: '2026-10-03T00:00:00Z' },
        { store: 'play', reviewId: 'gp5', rating: 5, reportId: null, reviewCreatedAt: null, seenAt: '2026-10-03T00:00:00Z' },
      ],
    },
    loading: false,
    error: null,
    reload: mocks.reload,
  }),
}))

import { StoreReviewsPanel } from './StoreReviewsPanel'

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

describe('StoreReviewsPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    state.enabled = false
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { status: 'ok', filed: 1, stores: [{ store: 'app_store', appId: '6761582648', status: 'ok', fetched: 3, newReviews: 2, filed: 1, detail: null }] } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(): Promise<void> {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(StoreReviewsPanel, { projectId: P1 })))
      await flush()
    })
  }

  const pullButton = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Pull now'))!

  it('is off by default: pulling is disabled and switching on saves the setting', async () => {
    await render()
    expect(pullButton().disabled).toBe(true)
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(toggle.checked).toBe(false)
    await act(async () => {
      toggle.click()
      await flush()
    })
    const [path, init] = mocks.apiFetch.mock.calls[0]
    expect(path).toBe(`/v1/admin/projects/${P1}/store/reviews/settings`)
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ enabled: true })
  })

  it('pulls when on, says what was filed, and links a filed review to its report', async () => {
    state.enabled = true
    await render()
    expect(container.querySelector('a[href="/reports/rep-1"]')?.textContent).toBe('Open report')
    expect(container.textContent).toContain('Seen, not filed')
    await act(async () => {
      pullButton().click()
      await flush()
    })
    expect(mocks.apiFetch.mock.calls[0][0]).toBe(`/v1/admin/projects/${P1}/store/reviews/pull`)
    expect(container.textContent).toContain('1 new report filed. · App Store: 2 new reviews, 1 filed')
  })
})
