/**
 * @vitest-environment jsdom
 *
 * /ops (docs/execplans/ops-hub-slack.md §5): the page renders today's counts,
 * the coverage matrix (a silent app first, hatched, with "How to connect"),
 * the feed with replies nested under their parent, each event's Slack state
 * as a glyph and words (the error on hover), Acknowledge for open events,
 * the filters in the URL, the "Slack bot is off" callout and the
 * migration-pending state.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpsCoverageResponse, OpsEvent, OpsFeedResponse } from '../lib/opsTypes'

const state = vi.hoisted(() => ({
  coverage: null as unknown,
  feed: null as unknown,
  errorCode: null as string | null,
  paths: [] as Array<string | null>,
  mutations: [] as string[],
}))

vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: async () => ({ ok: true, data: { events: [], apps: [], nextBefore: null, canAck: true } }),
  apiFetchMutate: async (path: string) => {
    state.mutations.push(path)
    return { ok: true, data: { id: 'x' } }
  },
}))
vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    const data = path?.startsWith('/v1/admin/ops/coverage') ? state.coverage : path?.startsWith('/v1/admin/ops/events') ? state.feed : null
    return { data, loading: false, error: state.errorCode ? 'pending' : null, errorCode: state.errorCode, isValidating: false, reload: () => {}, lastFetchedAt: null }
  },
}))
vi.mock('../components/OrgSwitcher', () => ({ useActiveOrgId: () => 'org-1' }))
vi.mock('../lib/pageContext', () => ({ usePublishPageContext: () => {} }))
vi.mock('../components/PageHeaderBar', async () => {
  const { createElement: h } = await import('react')
  return {
    PageHeaderBar: ({ title, children }: { title: string; children?: unknown }) => h('header', null, h('h1', null, title), children as never),
  }
})

import { OpsPage, opsFeedPath } from './OpsPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ev = (over: Partial<OpsEvent>): OpsEvent => ({
  id: 'e',
  organization_id: 'org-1',
  project_id: 'p1',
  category: 'alerts',
  severity: 'urgent',
  kind: 'deploy.failed',
  title: 'Production deploy failed',
  body: null,
  facts: [],
  url: null,
  amount_minor: null,
  currency: null,
  thread_key: 'deploy:o/r:production',
  parent_id: null,
  occurred_at: '2026-11-17T04:00:00Z',
  source: 'github',
  slack_channel: 'C1',
  slack_ts: '1.1',
  slack_error: null,
  acked_by: null,
  acked_at: null,
  ...over,
})

function coverage(over: Partial<OpsCoverageResponse> = {}): OpsCoverageResponse {
  return {
    apps: [
      { id: 'p1', name: 'Glot.it', slug: 'glot-it', icon_url: null },
      { id: 'p2', name: 'yen-yen', slug: 'yen-yen', icon_url: null },
    ],
    coverage: [{ project_id: 'p1', category: 'releases', last_at: '2026-11-17T04:00:00Z', count_7d: 2 }],
    today: { payments: { JPY: 12000 }, releases: 2, openAlerts: 1, since: '2026-11-17T00:00:00Z' },
    mutes: [],
    slack: { enabled: true },
    ...over,
  }
}

function feed(): OpsFeedResponse {
  return {
    apps: coverage().apps,
    canAck: true,
    nextBefore: null,
    events: [
      ev({ id: 'fix', parent_id: 'fail', severity: 'resolved', title: 'Fixed by the next deploy', occurred_at: '2026-11-17T04:30:00Z' }),
      ev({ id: 'pay', category: 'payments', severity: 'info', kind: 'payment.succeeded', title: 'New subscription', amount_minor: 1200, currency: 'JPY', facts: [{ label: 'Plan', value: 'Pro' }], thread_key: null, slack_ts: null, slack_error: 'channel_not_found', occurred_at: '2026-11-17T04:10:00Z' }),
      ev({ id: 'fail' }),
    ],
  }
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T05:00:00Z'))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.coverage = coverage()
  state.feed = feed()
  state.errorCode = null
  state.paths = []
  state.mutations = []
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

function render(url = '/ops') {
  act(() => {
    root.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(OpsPage)))
  })
}

describe('OpsPage', () => {
  it('shows today, then which app is silent, then the feed', () => {
    render()
    expect(host.querySelector('h1')?.textContent).toBe('Ops')
    const today = host.querySelector('[data-testid="ops-today"]')!.textContent!
    expect(today).toContain('¥12,000')
    expect(today).toContain('1 need a look')
    expect(host.querySelector('[data-testid="ops-open-alerts-link"]')!.getAttribute('href')).toBe('/ops?category=alerts&unacked=1#ops-feed')
    const rows = [...host.querySelectorAll('[data-testid^="ops-coverage-row-"]')].map((r) => r.getAttribute('data-testid'))
    expect(rows).toEqual(['ops-coverage-row-p2', 'ops-coverage-row-p1'])
    expect(host.querySelector('[data-testid="ops-coverage-row-p2"]')!.textContent).toContain('How to connect')
    expect(host.querySelector('[data-testid="ops-coverage-row-p2"] td')!.className).toContain('ci-nodata')
  })

  it('nests a reply under its parent and shows each Slack state with a shape', () => {
    render()
    const feedEl = host.querySelector('[data-testid="ops-feed"]')!
    const parent = feedEl.querySelector('[data-testid="ops-event-fail"]')!.closest('li')!
    expect(parent.querySelector('[data-testid="ops-event-fix"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="ops-slack-fail"]')!.textContent).toContain('✓ In Slack')
    const failed = host.querySelector('[data-testid="ops-slack-pay"]')!
    expect(failed.textContent).toContain('✕ Not posted')
    expect(failed.getAttribute('title')).toBe('channel_not_found')
    expect(host.querySelector('[data-testid="ops-event-pay"]')!.textContent).toContain('Amount: ¥1,200  ·  Plan: Pro')
  })

  it('acknowledges an open event', async () => {
    render()
    const btn = host.querySelector('[aria-label="Acknowledge: Production deploy failed"]') as HTMLButtonElement
    expect(btn).not.toBeNull()
    expect(host.querySelector('[aria-label="Acknowledge: Fixed by the next deploy"]')).toBeNull()
    await act(async () => {
      btn.click()
    })
    expect(state.mutations).toEqual(['/v1/admin/ops/events/fail/ack'])
  })

  it('pins unacknowledged urgent and warning rows on top, worst first', () => {
    state.feed = {
      ...feed(),
      events: [
        ev({ id: 'dep1', category: 'releases', severity: 'info', kind: 'deploy.succeeded', title: 'Deployed 81243e7', occurred_at: '2026-11-17T04:50:00Z' }),
        ev({ id: 'warn', severity: 'warn', kind: 'error.new', title: 'Error: Word not found', thread_key: null, occurred_at: '2026-11-17T04:40:00Z' }),
        ev({ id: 'dep2', category: 'releases', severity: 'info', kind: 'deploy.succeeded', title: 'Deployed 556b6c3', occurred_at: '2026-11-17T04:30:00Z' }),
        ev({ id: 'urg', title: 'Release failed (v0.23.1)', thread_key: null, occurred_at: '2026-11-17T01:00:00Z' }),
      ],
    }
    render()
    const pinned = [...host.querySelectorAll('[data-testid="ops-needs-look"] [data-testid^="ops-event-"]')].map((r) => r.getAttribute('data-testid'))
    expect(pinned).toEqual(['ops-event-urg', 'ops-event-warn'])
    expect(host.querySelector('[data-testid="ops-feed"] [data-testid="ops-event-urg"]')).toBeNull()
  })

  it('groups an app\'s info rows with a bulk Acknowledge, and shows a repeated event once', async () => {
    state.feed = {
      ...feed(),
      events: [
        ev({ id: 'd1', category: 'releases', severity: 'info', kind: 'deploy.succeeded', title: 'Deployed 81243e7', occurred_at: '2026-11-17T04:50:00Z' }),
        ev({ id: 'd2', category: 'releases', severity: 'info', kind: 'deploy.succeeded', title: 'Deployed 556b6c3', occurred_at: '2026-11-17T04:30:00Z' }),
        ev({ id: 'd3', category: 'releases', severity: 'info', kind: 'deploy.succeeded', title: 'Deployed 556b6c3', occurred_at: '2026-11-17T04:29:00Z' }),
      ],
    }
    render()
    const group = host.querySelector('[data-testid="ops-group-p1|releases"]')!
    expect(group.textContent).toContain('glot.it · 3 releases')
    // Collapsed: the repeated Info / In Slack / Acknowledge row is not drawn per event.
    expect(group.querySelector('[data-testid="ops-event-d1"]')).toBeNull()
    act(() => (host.querySelector('[data-testid="ops-group-toggle-p1|releases"]') as HTMLButtonElement).click())
    expect(group.querySelector('[data-testid="ops-event-d1"]')).not.toBeNull()
    expect(group.querySelector('[data-testid="ops-event-d3"]')).toBeNull()
    expect(group.querySelector('[data-testid="ops-copies-d2"]')!.textContent).toBe('×2')
    await act(async () => {
      ;(host.querySelector('[aria-label="Acknowledge all: glot.it · 3 releases"]') as HTMLButtonElement).click()
    })
    expect([...state.mutations].sort()).toEqual(['/v1/admin/ops/events/d1/ack', '/v1/admin/ops/events/d2/ack', '/v1/admin/ops/events/d3/ack'])
  })

  it('puts the columns that have data first, and stacks each app on a phone', () => {
    render()
    const heads = [...host.querySelectorAll('[data-testid="ops-coverage"] thead th')].map((th) => th.textContent!.trim())
    expect(heads[1]).toContain('Releases')
    expect(host.querySelector('[data-testid="ops-coverage-stacked"] [data-testid="ops-coverage-card-p1"]')!.textContent).toContain('×2')
  })

  it('reads its filters from the URL', () => {
    render('/ops?app=p1&category=alerts&unacked=1')
    expect(state.paths).toContain('/v1/admin/ops/events?org=org-1&limit=50&project=p1&category=alerts&unacked=1')
    expect(opsFeedPath('o', new URLSearchParams('category=nope&severity=urgent'))).toBe('/v1/admin/ops/events?org=o&limit=50&severity=urgent')
  })

  it('says when the Slack bot is off, and when the database update is missing', () => {
    state.coverage = coverage({ slack: { enabled: false } })
    render()
    expect(host.textContent).toContain('Slack bot is off')
    act(() => root.unmount())
    root = createRoot(host)
    state.errorCode = 'MIGRATION_PENDING'
    state.coverage = null
    state.feed = null
    render()
    expect(host.textContent).toContain('20261117120000_ops_hub')
  })
})
