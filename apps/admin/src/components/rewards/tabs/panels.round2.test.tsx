/**
 * @vitest-environment jsdom
 *
 * FILE: panels.round2.test.tsx
 * PURPOSE: Round-2 sweep (2026-11-18) on the Rewards tabs: retention never prints a lift
 *          over a 0-day base, the leaderboard says its scope and marks stale 30-day
 *          totals, flags read as warnings, quests read "Paused" while rewards are off,
 *          tiers and quests are rows (not cards in a card), and the simulator starts
 *          from the feed's action names.
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
    data: path ? (mocks.pages[path.split('?')[0]] ?? null) : null,
    loading: false,
    error: null,
    reload: vi.fn(),
    lastFetchedAt: null,
    isValidating: false,
  }),
}))
vi.mock('../../../lib/supabase', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../lib/realtime', () => ({ useRealtimeReload: () => {} }))
vi.mock('../../../lib/useEntitlements', () => ({ useEntitlements: () => ({ has: () => true }) }))
vi.mock('../../../lib/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))

import { ContributorsTab, QuestsTab, RetentionAnalyticsTab, SandboxSimulatorTab, TierLadderTab, ActivityRulesTab } from './panels'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.pages = {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(node: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, node))
  })
}

describe('Retention tab', () => {
  it('says "Not enough data" with no callout when the others median is 0 days', async () => {
    mocks.pages['/v1/admin/rewards/retention-impact'] = {
      top_tier: { slug: 'champion', display_name: 'Champion', count: 9, median_retention_days: 8 },
      all_others: { count: 830, median_retention_days: 0 },
      lift_pct: 45708510,
    }
    await render(createElement(RetentionAnalyticsTab))
    const text = container.textContent ?? ''
    expect(text).not.toContain('45708510')
    expect(text).not.toContain('45,708,510')
    expect(text).toContain('Not enough data')
    expect(text).not.toContain('strong')
    expect(container.querySelector('.bg-ok-muted\\/50')).toBeNull()
    // 0d beside "Not enough data" reads as a measured zero: the unusable median is a dash, in a flat row.
    const stats = container.querySelector('[data-testid="rewards-retention-stats"]')!
    expect(stats.textContent).toContain('Others median—')
    expect(stats.textContent).toContain('Champion median8d')
    expect(text).not.toContain('0d')
  })

  it('does not crash when the server has no tiers to compare', async () => {
    mocks.pages['/v1/admin/rewards/retention-impact'] = { cohorts: [], message: 'No tiers configured' }
    await render(createElement(RetentionAnalyticsTab))
    expect(container.textContent).toContain('Not enough data')
  })
})

describe('Contributors tab', () => {
  beforeEach(() => {
    mocks.pages['/v1/admin/rewards/leaderboard'] = {
      data: [
        {
          end_user_id: 'u1',
          total_points: 12000,
          points_30d: 9777,
          end_users: { external_user_id: '23ba64c3-9ebf-4063-99f5-df285e098cbc', display_name: null, anti_fraud_flags: ['velocity_anomaly'], last_seen_at: '2026-06-01T00:00:00Z' },
          reward_tiers: { slug: 'champion', display_name: 'Champion' },
        },
        {
          end_user_id: 'u2',
          total_points: 3000,
          points_30d: 2830,
          end_users: { external_user_id: 'kenji', display_name: 'Kenji', anti_fraud_flags: [], last_seen_at: new Date().toISOString() },
          reward_tiers: { slug: 'champion', display_name: 'Champion' },
        },
      ],
      meta: { range: '30d', limit: 25, offset: 0, total: 839 },
    }
  })

  it('names its scope, marks the stale 30-day total and shows flags as warnings', async () => {
    await render(createElement(ContributorsTab, { canEdit: false }))
    const text = container.textContent ?? ''
    // The title follows the selected 30-day range, not "839 · all time" (2026-11-19).
    expect(text).toContain('Testers · last 30 days · all apps')
    expect(text).not.toContain('839 testers with points · all time')
    expect(container.querySelector('[data-testid="rewards-contributors-scope"]')?.textContent).toContain('last 30 days')
    // Stale: "—" plus one legend, not "Not recounted" on every row.
    const stale = container.querySelectorAll('[data-testid="rewards-points-stale"]')
    expect(stale).toHaveLength(1)
    expect(stale[0]!.textContent).toBe('—')
    expect(text).not.toContain('Not recounted')
    expect(container.querySelectorAll('[data-testid="rewards-stale-legend"]')).toHaveLength(1)
    expect(text).not.toContain('9,777')
    expect(text).toContain('2,830')
    expect(text).toContain('Tester #23ba')
    // One small "Held" mark naming the flag in its label; one filter chip with the count; no row tint.
    const hold = container.querySelector('[data-testid="rewards-payout-hold"]')
    expect(hold?.getAttribute('title')).toBe('Payouts held: velocity anomaly')
    expect(container.querySelector('[data-testid="rewards-held-filter"]')?.textContent).toContain('1 held on this page')
    expect(container.innerHTML).not.toContain('bg-warn-muted/30')
    expect(container.innerHTML).not.toContain('text-danger-foreground')
    expect(container.innerHTML).not.toContain('bg-danger')
  })
})

describe('Contributors held filter', () => {
  beforeEach(() => {
    mocks.pages['/v1/admin/rewards/leaderboard'] = {
      data: [
        { end_user_id: 'u1', total_points: 900, points_30d: 900, end_users: { external_user_id: 'a', display_name: 'Ana', anti_fraud_flags: [], last_seen_at: new Date().toISOString() }, reward_tiers: null },
        { end_user_id: 'u2', total_points: 800, points_30d: 800, end_users: { external_user_id: 'b', display_name: 'Ben', anti_fraud_flags: ['velocity_anomaly'], last_seen_at: new Date().toISOString() }, reward_tiers: null },
      ],
      meta: { range: '30d', limit: 25, offset: 0, total: 60 },
    }
  })

  it('keeps real ranks while filtered and clears itself on a new page', async () => {
    await render(createElement(ContributorsTab, { canEdit: false }))
    const chip = container.querySelector('[data-testid="rewards-held-filter"]') as HTMLButtonElement
    await act(async () => { chip.click() })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(1)
    // Ben is second on the page, so he keeps rank 2 under the filter.
    expect(rows[0]!.querySelector('td')!.textContent).toBe('2')
    const next = container.querySelector('button[aria-label="Next page"]') as HTMLButtonElement
    await act(async () => { next.click() })
    expect(container.querySelector('[data-testid="rewards-held-filter"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
  })
})

describe('Quests tab while rewards are off', () => {
  it('reads Paused instead of Active and uses rows, not cards in the card', async () => {
    mocks.pages['/v1/admin/rewards/quests'] = [
      { id: 'q1', name: 'Beta Bug Hunter', description: null, completion_points: 250, expires_after_days: null, repeatable: false, enabled: true, steps: [{ action: 'report.submitted', label: 'Submit a report' }] },
    ]
    await render(createElement(QuestsTab, { canEdit: true, paused: true }))
    const rows = container.querySelector('[data-testid="rewards-quest-rows"]')
    expect(rows?.textContent).toContain('Paused')
    expect(rows?.textContent).not.toContain('Active')
  })
})

describe('Tier ladder', () => {
  it('lays tiers out as rows with full-width, uniquely labelled fields', async () => {
    mocks.pages['/v1/admin/rewards/tiers'] = [
      { id: 't1', slug: 'explorer', display_name: 'Explorer', display_order: 1, points_threshold: 0, perks: {}, host_credit_payload: null, monetary_reward_usd: null, enabled: true },
      { id: 't2', slug: 'contributor', display_name: 'Contributor', display_order: 2, points_threshold: 200, perks: {}, host_credit_payload: null, monetary_reward_usd: null, enabled: true },
    ]
    await render(createElement(TierLadderTab, { canEdit: true }))
    expect(container.querySelector('[data-testid="rewards-tier-rows"]')).not.toBeNull()
    const ids = [...container.querySelectorAll('input')].map((i) => i.id).filter(Boolean)
    expect(new Set(ids).size).toBe(ids.length)
    expect(container.querySelector('#tier-t2-name')).not.toBeNull()
  })
})

describe('Activity rules with no rule rows', () => {
  it('says the built-in values are in use instead of "No custom rules yet"', async () => {
    mocks.pages['/v1/admin/rewards/rules'] = []
    await render(createElement(ActivityRulesTab, { canEdit: true }))
    const text = container.textContent ?? ''
    expect(text).toContain('Built-in point values in use')
    const rows = [...container.querySelectorAll('[data-testid="rewards-builtin-values"] tbody tr')].map((r) => r.textContent)
    expect(rows).toEqual(['report.submitted10', 'report.triaged50', 'session_minute1'])
    expect(text).not.toContain('No custom rules yet')
    expect(text).not.toContain('4-tier')
    expect(text).not.toContain('Save rules')
  })
})

describe('Simulator', () => {
  it('starts from the action names the live feed uses and suggests them', async () => {
    mocks.pages['/v1/admin/rewards/activity'] = { events: [], stats_24h: { total: 0, accepted: 0, rejected: 0, points_awarded: 0, rejection_rate_pct: 0, top_actions: [{ action: 'session_minute', count: 32 }] } }
    await render(createElement(SandboxSimulatorTab))
    const values = [...container.querySelectorAll('input')].map((i) => i.value)
    expect(values).toContain('report.submitted')
    expect(values).not.toContain('report_submit')
    const options = [...container.querySelectorAll('#rewards-sim-actions option')].map((o) => o.getAttribute('value'))
    expect(options).toContain('session_minute')
  })
})
