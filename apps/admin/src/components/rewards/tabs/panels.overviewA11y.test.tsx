/**
 * FILE: panels.overviewA11y.test.tsx
 * PURPOSE: Rewards overview keeps the 24 h counts readable (no low-contrast text-ok) and
 *          shows the 24h activity list as rows with a Show all toggle, not an inner scroll box
 *          whose last row was half cut (2026-11-19).
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
    '/v1/admin/rewards/leaderboard?range=30d&limit=25&offset=0': { data: [] },
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

  it('lists the 24h activity without an inner scroll box', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(OverviewTab)))
    })
    const list = container.querySelector('[aria-label="Activity in the last 24 hours"]')
    expect(list).toBeTruthy()
    expect(list!.getAttribute('role')).toBe('region')
    expect(list!.className).not.toContain('overflow-y-auto')
    expect(list!.className).not.toContain('max-h-')
    expect(list!.textContent).toContain('Ada')
    // One group needs no toggle.
    expect(container.querySelector('[data-testid="rewards-feed-toggle"]')).toBeNull()
  })

  it('shows five feed groups, then all of them on Show all', async () => {
    const now = Date.now()
    ;(mocks.pages['/v1/admin/rewards/activity'] as { events: unknown[] }).events = Array.from({ length: 7 }, (_, i) => ({
      id: `ev-${i}`,
      action: 'session_minute',
      points_awarded: 1,
      rejected_reason: null,
      metadata: null,
      created_at: new Date(now - i * 60_000).toISOString(),
      end_users: { external_user_id: `user-${i}`, display_name: `Tester ${i}` },
    }))
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(OverviewTab)))
    })
    expect(container.querySelectorAll('[data-testid="rewards-feed-group"]')).toHaveLength(5)
    const toggle = container.querySelector('[data-testid="rewards-feed-toggle"]') as HTMLButtonElement
    expect(toggle.textContent).toBe('Show all 7')
    await act(async () => { toggle.click() })
    expect(container.querySelectorAll('[data-testid="rewards-feed-group"]')).toHaveLength(7)
    // The action keeps the spelling Activity rules and the Simulator use, on a neutral chip.
    const chip = container.querySelector('[data-testid="rewards-feed-group"] span')
    expect(chip!.textContent).toBe('session_minute')
    expect(chip!.className).not.toContain('ok-')
    expect(container.textContent).toContain('all apps')
  })
})
