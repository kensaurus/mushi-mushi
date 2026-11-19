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
import { eventsInLast24h, groupActivityEvents, rewardsHeaderChip, sortTiersByLadder, testerLabel, tierEmptyMessage } from './overviewHelpers'
import { rewardsSentence } from './RewardsSnapshotStrip'
import { EMPTY_REWARDS_STATS } from './types'

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
      '/v1/admin/rewards/leaderboard?range=30d&limit=25&offset=0': {
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
    expect(host.querySelector('[data-testid="rewards-payouts-card"]')).not.toBeNull()
    const quests = Array.from(host.querySelectorAll('[aria-label="Running quests"] li')).map((li) => li.textContent)
    expect(quests).toEqual([expect.stringContaining('Try checkout')])
  })

  it('leaves out the payouts card when nothing is owed (the status line already says $0.00)', () => {
    pages.data = {}
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(RewardsOverviewHighlights, { pendingPayoutUsd: 0 })))
    })
    expect(host.querySelector('[data-testid="rewards-payouts-card"]')).toBeNull()
    expect(host.textContent).not.toContain('$0.00')
  })
})

describe('rewards overview fresh-eyes fixes (2026-11-18)', () => {
  it('never shows a raw UUID as a tester name', () => {
    expect(testerLabel({ external_user_id: '23ba64c3-9ebf-4063-99f5-df285e0aaaaa', display_name: null })).toBe('Tester #23ba')
    expect(testerLabel({ external_user_id: 'x1', display_name: 'Zaelana' })).toBe('Zaelana')
    expect(testerLabel(null)).toBe('Anonymous tester')
  })

  it('sorts tiers in ladder order, by threshold when known', () => {
    const entries: Array<[string, number]> = [['explorer', 487], ['champion', 9], ['contributor', 4]]
    expect(sortTiersByLadder(entries).map(([s]) => s)).toEqual(['explorer', 'contributor', 'champion'])
    const tiers = [{ slug: 'explorer', points_threshold: 0 }, { slug: 'contributor', points_threshold: 5000 }, { slug: 'champion', points_threshold: 100 }]
    expect(sortTiersByLadder(entries, tiers).map(([s]) => s)).toEqual(['explorer', 'champion', 'contributor'])
  })

  it('groups the 24 h feed by tester and action, newest group first', () => {
    const u1: { external_user_id: string; display_name: string | null } = { external_user_id: '8e0b3e08-4c88-44cb-ad00-000000000000', display_name: null }
    const u2 = { external_user_id: 'u2', display_name: 'Aki' }
    const ev = (id: string, at: string, user: typeof u1, extra = {}) => ({ id, action: 'session_minute', points_awarded: 1, rejected_reason: null, metadata: null, created_at: at, end_users: user, ...extra })
    const groups = groupActivityEvents([
      ev('a', '2026-11-18T09:00:00Z', u2),
      ev('b', '2026-11-18T05:00:00Z', u1),
      ev('c', '2026-11-18T04:00:00Z', u1),
      ev('d', '2026-11-18T03:00:00Z', u1),
      ev('e', '2026-11-18T02:00:00Z', u1, { rejected_reason: 'cap', points_awarded: null }),
    ])
    expect(groups.map((g) => [g.tester, g.count, g.points, g.rejectedReason])).toEqual([
      ['Aki', 1, 1, null],
      ['Tester #8e0b', 3, 3, null],
      ['Tester #8e0b', 1, 0, 'cap'],
    ])
    expect(groups[1]!.latest.id).toBe('b')
  })

  it('states the program without repeating the 30-day counters', () => {
    const off = rewardsSentence({ ...EMPTY_REWARDS_STATS, projectRewardsEnabled: false, activeContributors30d: 92, pointsAwarded30d: 1017 })
    expect(off).toBe('Rewards are off for this app, so its new activity earns no points. The counts cover all your apps.')
    const named = rewardsSentence({ ...EMPTY_REWARDS_STATS, projectRewardsEnabled: false, projectName: 'kensaur.us' })
    expect(named).toContain('Rewards are off for kensaur.us')
    const on = rewardsSentence({ ...EMPTY_REWARDS_STATS, projectRewardsEnabled: true, activeContributors30d: 92, pointsAwarded30d: 1017 })
    expect(on).not.toMatch(/92|1,017/)
  })
})
