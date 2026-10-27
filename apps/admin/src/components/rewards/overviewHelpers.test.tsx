/**
 * @vitest-environment jsdom
 *
 * Rewards (report 5f2ab6c5): the header chip follows the open app's switch,
 * the tier panel never denies a tester with points, the "last 24 h" feed
 * lists only the last 24 hours, and the overview opens on top testers,
 * payouts waiting and quests.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventsInLast24h, rewardsHeaderChip, tierEmptyMessage } from './overviewHelpers'

const pages = vi.hoisted(() => ({ data: {} as Record<string, unknown> }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => ({ data: path ? (pages.data[path] ?? null) : null, loading: false, error: null, reload: vi.fn(), isValidating: false, lastFetchedAt: null }),
}))

import { RewardsOverviewHighlights } from './RewardsOverviewHighlights'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('rewardsHeaderChip', () => {
  it('never says active while the app has rewards off', () => {
    expect(rewardsHeaderChip({ entitled: true, projectEnabled: false, hasProject: true })).toEqual({ label: 'Off for this app', tone: 'off' })
    expect(rewardsHeaderChip({ entitled: true, projectEnabled: true, hasProject: true })).toEqual({ label: 'On for this app', tone: 'active' })
    expect(rewardsHeaderChip({ entitled: false, projectEnabled: true, hasProject: true }).tone).toBe('readonly')
  })
})

describe('tierEmptyMessage', () => {
  it('does not say "No contributors yet" when someone earned points', () => {
    expect(tierEmptyMessage(1).title).toBe('Nobody has reached a tier yet')
    expect(tierEmptyMessage(1).description).toContain('1 tester has earned points')
    expect(tierEmptyMessage(0).title).toBe('No testers yet')
  })
})

describe('eventsInLast24h', () => {
  it('drops a three-week-old event from the 24 h feed', () => {
    const now = Date.parse('2026-10-27T00:00:00Z')
    const events = [{ id: 'a', created_at: '2026-10-26T12:00:00Z' }, { id: 'b', created_at: '2026-10-06T00:00:00Z' }]
    expect(eventsInLast24h(events, now).map((e) => e.id)).toEqual(['a'])
  })
})

describe('RewardsOverviewHighlights', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('shows top testers, payouts waiting and running quests', () => {
    pages.data = {
      '/v1/admin/rewards/leaderboard?range=30d&limit=5&offset=0': {
        data: [
          { end_user_id: 'u1', points_30d: 420, end_users: { external_user_id: 'x1', display_name: 'Aki' }, reward_tiers: { display_name: 'Champion' } },
          { end_user_id: 'u2', points_30d: 0, end_users: { external_user_id: 'x2', display_name: 'Idle' }, reward_tiers: null },
        ],
      },
      '/v1/admin/rewards/quests': [
        { id: 'q1', name: 'Try checkout', completion_points: 50, enabled: true },
        { id: 'q2', name: 'Old quest', completion_points: 500, enabled: false },
      ],
    }
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(RewardsOverviewHighlights, { pendingPayoutUsd: 12.5 })))
    })
    const testers = Array.from(host.querySelectorAll('[aria-label="Top testers"] li')).map((li) => li.textContent)
    expect(testers).toEqual([expect.stringContaining('Aki')])
    expect(testers[0]).toContain('420 pts')
    expect(host.textContent).toContain('$12.50')
    const quests = Array.from(host.querySelectorAll('[aria-label="Running quests"] li')).map((li) => li.textContent)
    expect(quests).toEqual([expect.stringContaining('Try checkout')])
  })
})
