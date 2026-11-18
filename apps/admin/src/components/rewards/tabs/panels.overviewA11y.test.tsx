/**
 * FILE: panels.overviewA11y.test.tsx
 * PURPOSE: Rewards overview keeps the 24 h counts readable (no low-contrast text-ok) and
 *          lets keyboard users scroll the 24h activity list (report 2b076ca8).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pages: {} as Record<string, unknown>,
}))

vi.mock('../../../lib/usePageData', () => ({
  usePageData: (path: string | null) => ({
    data: path ? (mocks.pages[path] ?? null) : null,
    loading: false,
    error: null,
    reload: vi.fn(),
    lastFetchedAt: null,
    isValidating: false,
  }),
}))
vi.mock('../../../lib/supabase', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../lib/realtime', () => ({ useRealtimeReload: () => {} }))
vi.mock('../../../lib/useEntitlements', () => ({ useEntitlements: () => ({ has: () => false }) }))
vi.mock('../../../lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

import { OverviewTab } from './panels'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.pages = {
    '/v1/admin/rewards/overview': {
      active_contributors_30d: 0,
      points_awarded_30d: 0,
      tier_distribution: {},
      pending_payout_liability_usd: 0,
    },
    '/v1/admin/rewards/activity': {
      events: [
        {
          id: 'ev-1',
          action: 'report_submitted',
          points_awarded: 10,
          rejected_reason: null,
          metadata: null,
          created_at: new Date().toISOString(),
          end_users: { external_user_id: 'user-1', display_name: 'Ada' },
        },
      ],
      stats_24h: {
        total: 20,
        accepted: 17,
        rejected: 3,
        points_awarded: 40,
        rejection_rate_pct: 15,
        top_actions: [],
      },
    },
    '/v1/admin/rewards/leaderboard?range=30d&limit=5&offset=0': { data: [] },
    '/v1/admin/rewards/quests': [],
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function classes(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('rewards overview accessibility', () => {
  it('shows the 24 h counts as one inline strip in readable ink, not grey boxes or text-ok', async () => {
    // 2026-11-18: the four grey stat boxes became one strip (one level of card).
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(OverviewTab)))
    })
    const strip = container.querySelector('[data-testid="rewards-feed-strip"]')
    expect(strip).toBeTruthy()
    expect(strip!.querySelector('.bg-surface-overlay')).toBeNull()
    const accepted = Array.from(strip!.querySelectorAll('span')).find((el) => el.textContent === '17')
    expect(accepted).toBeTruthy()
    expect(classes(accepted!)).toContain('text-fg')
    expect(strip!.querySelector('.text-ok')).toBeNull()
    expect(strip!.textContent).toContain('+40 pts')
  })

  it('lets the keyboard reach the 24h activity list', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(OverviewTab)))
    })
    const list = container.querySelector('[aria-label="Activity in the last 24 hours"]')
    expect(list).toBeTruthy()
    expect(list!.getAttribute('role')).toBe('region')
    expect(list!.getAttribute('tabindex')).toBe('0')
    expect(list!.className).toContain('overflow-y-auto')
    expect(list!.textContent).toContain('Ada')
  })
})
