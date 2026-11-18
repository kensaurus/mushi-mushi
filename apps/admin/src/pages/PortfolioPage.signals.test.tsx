/**
 * @vitest-environment jsdom
 */

/**
 * The Apps page, signal pass (2026-11-18; owner: "why arent all other pages
 * enhanced like [the CI page]?"):
 *  - Refresh reads the portfolio ONCE (it used to read it with the icon flag,
 *    then again through page.reload()), and shows that read;
 *  - an apps × signals heat grid, worst first, with highlight keys per app;
 *  - alert cards for the worst apps, each with one action;
 *  - a ranking instead of "All 10 apps need you";
 *  - a Table / Cards switch remembered in localStorage (and still working
 *    when storage throws).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortfolioCard, PortfolioResponse } from '../lib/portfolioTypes'

const NOW = Date.now()
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

const card = (over: Partial<PortfolioCard>): PortfolioCard => ({
  projectId: 'p',
  name: 'p',
  slug: null,
  kind: 'app',
  kindSource: 'declared',
  worst: 'drift',
  elements: {},
  error: null,
  needsLook: [],
  openReports: 0,
  sdk: [{ projectId: 'p', package: '@mushi-mushi/web', version: '1.33.0', latest: '1.33.0', status: 'current', reason: 'Latest.' }],
  latestRelease: { version: 'v1.0.0', publishedAt: hoursAgo(24 * 3) },
  radar: { checkedAt: hoursAgo(5), status: 'pass', open: { error: 0, warn: 0, info: 0 }, unchecked: 0, errored: 0 },
  spend: { llmUsd30d: 0, llmCalls30d: 0, partial: false, autofixCapUsd: null, monthlyLlmBudgetUsd: null, capsKnown: true },
  unreadable: [],
  ciFailsToday: 0,
  ...over,
})

const portfolio = (cards: PortfolioCard[]): PortfolioResponse => ({
  organizationId: 'o1',
  organizationName: 'Team',
  generatedAt: new Date(NOW).toISOString(),
  page: 1,
  pageSize: 25,
  totalProjects: cards.length,
  cards,
  repeatedGroups: 0,
  holes: 0,
  readErrors: [],
})

const CARDS = [
  card({ projectId: 'calm', name: 'calm-app', openReports: 1 }),
  card({ projectId: 'glot', name: 'glot.it', openReports: 3, ciFailsToday: 4 }),
  card({ projectId: 'yen', name: 'yen-yen', openReports: 12, radar: { checkedAt: hoursAgo(5), status: 'fail', open: { error: 2, warn: 1, info: 0 }, unchecked: 0, errored: 0 } }),
  card({ projectId: 'twm', name: 'twm', openReports: 2 }),
]

const state = vi.hoisted(() => ({
  portfolioReload: null as null | ReturnType<typeof import('vitest').vi.fn>,
  data: null as unknown,
}))

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { error: null, errorCode: null, errorEndpoint: null, requestId: null, reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false }
    if (path === '/v1/admin/orgs/o1/portfolio') return { ...base, reload: state.portfolioReload, lastFetchedAt: new Date(NOW - 60_000).toISOString(), data: state.data }
    if (path === '/v1/admin/orgs/o1/portfolio/findings') return { ...base, data: { organizationId: 'o1', generatedAt: '', groups: [], sdkSkew: [], holes: [], crossProject: [], readErrors: [] } }
    if (path === '/v1/admin/setup') {
      return {
        ...base,
        data: {
          has_any_project: true,
          projects: [
            { project_id: 'glot', project_name: 'glot.it', project_slug: 'glot', created_at: '', steps: [{ id: 'sdk_installed', label: '', description: '', complete: true, required: true, cta_to: '', cta_label: '', diagnostic: { last_sdk_seen_at: hoursAgo(0.2), last_sdk_origin: null, last_sdk_user_agent: null, last_sdk_endpoint_host: null } }], required_total: 1, required_complete: 1, total: 1, complete: 1, done: true, report_count: 0, fix_count: 0, merged_fix_count: 0 },
            { project_id: 'yen', project_name: 'yen-yen', project_slug: 'yen', created_at: '', steps: [{ id: 'sdk_installed', label: '', description: '', complete: true, required: true, cta_to: '', cta_label: '', diagnostic: { last_sdk_seen_at: hoursAgo(24 * 10), last_sdk_origin: null, last_sdk_user_agent: null, last_sdk_endpoint_host: null } }], required_total: 1, required_complete: 1, total: 1, complete: 1, done: true, report_count: 0, fix_count: 0, merged_fix_count: 0 },
          ],
        },
      }
    }
    if (path === '/v1/admin/projects') return { ...base, data: { projects: [] } }
    if (path === '/v1/admin/workspace/projects') return { ...base, data: { projects: [] } }
    return { ...base, loading: path != null, data: null }
  },
}))

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), apiFetch }))
vi.mock('../components/OrgSwitcher', () => ({ useActiveOrgId: () => 'o1' }))
vi.mock('../lib/projectGroups', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useProjectGroups: () => ({ data: { groups: [] }, loading: false, reload: () => {} }),
  readActiveGroup: () => null,
  writeActiveGroup: () => {},
}))
vi.mock('../components/PageHeaderBar', () => ({
  PageHeaderBar: ({ title, children }: { title: string; children?: unknown }) => createElement('header', null, createElement('h1', null, title), children as never),
}))
// The other sections read their own routes; they are not under test here.
for (const m of ['ReleasesCard', 'FunnelCard', 'CiRunnersCard', 'MonetizationCard', 'SpendLedgerCard', 'AccountsRegisterCard', 'SharedResourcesCard', 'ConnectorsCard', 'DigestCard']) {
  vi.doMock(`../components/portfolio/${m}`, () => ({ [m]: () => null }))
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let PortfolioPage: typeof import('./PortfolioPage').PortfolioPage

beforeEach(async () => {
  state.portfolioReload = vi.fn()
  state.data = portfolio(CARDS)
  apiFetch.mockReset()
  try {
    localStorage.clear()
  } catch {
    /* storage may be off */
  }
  ;({ PortfolioPage } = await import('./PortfolioPage'))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(PortfolioPage)))
  })
}

const portfolioReads = () => apiFetch.mock.calls.filter(([p]) => typeof p === 'string' && /\/v1\/admin\/orgs\/o1\/portfolio(\?|$)/.test(p))

describe('Apps Refresh', () => {
  it('reads the portfolio once and shows that read', async () => {
    const fresh = portfolio([...CARDS, card({ projectId: 'new', name: 'brand-new-app', openReports: 30 })])
    apiFetch.mockResolvedValue({ ok: true, data: fresh })
    await render()
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Refresh')!
    await act(async () => {
      btn.click()
    })
    expect(portfolioReads()).toHaveLength(1)
    expect(portfolioReads()[0]![0]).toContain('refreshIcons=1')
    expect(state.portfolioReload).not.toHaveBeenCalled()
    expect(container.textContent).toContain('brand-new-app')
  })

  it('falls back to the normal read when the flagged read fails', async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: 'X', message: 'down' } })
    await render()
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Refresh')!
    await act(async () => {
      btn.click()
    })
    expect(state.portfolioReload).toHaveBeenCalledTimes(1)
  })
})

const text = (sel: string) => container.querySelector(sel)?.textContent ?? ''

describe('Apps signals', () => {
  it('ranks the apps in a heat grid, worst first, with every signal as text', async () => {
    await render()
    const rows = [...container.querySelectorAll('[data-testid^="heat-row-"]')].map((r) => r.getAttribute('data-testid'))
    // glot.it: CI failed 4 times today; yen-yen: 12 bugs and 2 serious risks.
    expect(rows).toEqual(['heat-row-glot', 'heat-row-yen', 'heat-row-twm', 'heat-row-calm'])
    const glot = container.querySelector('[data-testid="heat-row-glot"]')!
    const cell = (col: string) => glot.querySelector(`[data-col="${col}"]`)!
    expect(cell('ci').textContent).toBe('4')
    expect(cell('ci').className).toContain('ci-fail-5')
    expect(cell('sdk').textContent).toBe('latest')
    expect(cell('release').textContent).toBe('3d')
    // Checked in 12 minutes ago: live, with the ok shape.
    expect(cell('checkin').textContent).toBe('12m')
    expect(cell('checkin').querySelector('svg[data-tone="ok"]')).not.toBeNull()
    // yen-yen went silent 10 days ago; twm is not in the setup list, so its check-in is unknown, not "never".
    expect(container.querySelector('[data-testid="heat-row-yen"] [data-col="checkin"] svg[data-tone="danger"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="heat-row-twm"] [data-col="checkin"]')!.className).toContain('ci-nodata')
    expect(text('[data-testid="portfolio-signal-grid-legend"]')).toContain('no data')
  })

  it('leads with alert cards for the worst three, one action each, and a ranking headline', async () => {
    await render()
    const cards = [...container.querySelectorAll('[data-testid^="portfolio-alert-"]')]
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual(['portfolio-alert-glot', 'portfolio-alert-yen', 'portfolio-alert-twm'])
    expect(cards[0]!.getAttribute('data-severity')).toBe('critical')
    expect(cards[0]!.textContent).toContain('4 CI jobs failed today')
    const action = cards[1]!.querySelector('a')!
    expect(action.textContent).toBe('Open bugs')
    expect(action.getAttribute('href')).toMatch(/^\/reports\?.*project=yen/)
    expect(container.textContent).toContain('Worst first: glot.it (4 CI jobs failed today, 3 open bugs) · yen-yen (12 open bugs, 2 serious risks) · twm (2 open bugs) · 1 more needs you.')
    expect(container.textContent).not.toMatch(/All \d+ apps need you/)
  })

  it('lights an app across the alert, the grid row and its card', async () => {
    await render()
    const alert = container.querySelector('[data-testid="portfolio-alert-yen"]') as HTMLElement
    act(() => alert.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(container.querySelector('[data-testid="heat-row-yen"]')!.getAttribute('data-hl')).toBe('on')
    expect(container.querySelector('[data-testid="heat-row-glot"]')!.getAttribute('data-hl')).toBe('dim')
    act(() => alert.click())
    expect(text('[data-testid="portfolio-pinned"]')).toContain('yen-yen')
  })

  it('switches to cards, remembers it, and the cards light with the rest', async () => {
    await render()
    const cardsBtn = [...container.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Cards') as HTMLElement
    await act(async () => cardsBtn.click())
    expect(container.querySelector('[data-testid="portfolio-signal-grid"]')).toBeNull()
    expect(container.querySelector('[data-testid="portfolio-card-glot"]')).not.toBeNull()
    expect(localStorage.getItem('mushi:portfolio:view')).toBe('cards')
    const alert = container.querySelector('[data-testid="portfolio-alert-glot"]') as HTMLElement
    act(() => alert.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(container.querySelector('[data-testid="portfolio-card-glot"]')!.getAttribute('data-hl')).toBe('on')

    act(() => root.unmount())
    root = createRoot(container)
    await render()
    expect(container.querySelector('[data-testid="portfolio-signal-grid"]')).toBeNull()
  })

  it('still works when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    await render()
    expect(container.querySelector('[data-testid="portfolio-signal-grid"]')).not.toBeNull()
    const cardsBtn = [...container.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Cards') as HTMLElement
    await act(async () => cardsBtn.click())
    expect(container.querySelector('[data-testid="portfolio-signal-grid"]')).toBeNull()
  })
})
