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
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortfolioCard, PortfolioResponse } from '../lib/portfolioTypes'
import type { PortfolioPage as PortfolioPageType } from './PortfolioPage'

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
  portfolioReload: null as null | ReturnType<typeof vi.fn>,
  data: null as unknown,
  findings: null as unknown,
}))

const NO_FINDINGS = { organizationId: 'o1', generatedAt: '', groups: [], sdkSkew: [], holes: [], crossProject: [], readErrors: [] }

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = { error: null, errorCode: null, errorEndpoint: null, requestId: null, reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false }
    if (path === '/v1/admin/orgs/o1/portfolio') return { ...base, reload: state.portfolioReload, lastFetchedAt: new Date(NOW - 60_000).toISOString(), data: state.data }
    if (path === '/v1/admin/orgs/o1/portfolio/findings') return { ...base, data: state.findings }
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
  PageHeaderBar: ({ title, children, helpWhatIsIt }: { title: string; children?: unknown; helpWhatIsIt?: string }) =>
    createElement('header', null, createElement('h1', null, title), createElement('p', { 'data-testid': 'help-what' }, helpWhatIsIt), children as never),
}))
// The other sections read their own routes; they are not under test here.
for (const m of ['ReleasesCard', 'FunnelCard', 'CiRunnersCard', 'MonetizationCard', 'SpendLedgerCard', 'AccountsRegisterCard', 'SharedResourcesCard', 'ConnectorsCard', 'DigestCard']) {
  vi.doMock(`../components/portfolio/${m}`, () => ({ [m]: () => createElement('div', { 'data-testid': `mock-${m}` }) }))
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let PortfolioPage: typeof PortfolioPageType

beforeEach(async () => {
  state.portfolioReload = vi.fn()
  state.data = portfolio(CARDS)
  state.findings = NO_FINDINGS
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

/** Shows the router's location, and keeps its navigate for back/forward. */
const nav = { go: null as null | ((delta: number) => void) }
function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  nav.go = (delta) => navigate(delta)
  return createElement('output', { 'data-testid': 'location' }, `${location.pathname}${location.search}`)
}

async function render(entry = '/portfolio') {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [entry] }, createElement(PortfolioPage), createElement(LocationProbe)))
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
    // No subtitle that repeats the Open bugs column under the app's name.
    expect(container.querySelector('[data-testid="heat-row-yen"] th')!.textContent).toBe('yen-yen')
  })

  it('leads with alert cards for the worst three, one action each, and a ranking headline', async () => {
    await render()
    const cards = [...container.querySelectorAll('[data-testid^="portfolio-alert-"]')]
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual(['portfolio-alert-glot', 'portfolio-alert-yen', 'portfolio-alert-twm'])
    expect(cards[0]!.getAttribute('data-severity')).toBe('critical')
    // The title names the problem; the big number alone says how many.
    expect(cards[0]!.textContent).toContain('CI failing today')
    expect(cards[0]!.textContent).not.toContain('4 CI jobs failed today')
    expect(cards[1]!.textContent).toContain('Open bug reports')
    expect(cards[1]!.textContent).not.toContain('12 open bugs')
    const action = cards[1]!.querySelector('a')!
    expect(action.textContent).toBe('Open bugs')
    expect(action.getAttribute('href')).toMatch(/^\/reports\?.*project=yen/)
    expect(container.textContent).toContain('Worst first: glot.it (4 CI jobs failed today, 3 open bugs) · yen-yen (12 open bugs, 2 serious risks) · twm (2 open bugs) · 1 more needs you.')
    expect(container.textContent).not.toMatch(/All \d+ apps need you/)
    // The headline is chips (icon, name, open bugs) and "+1 more"; the sentence is for screen readers only.
    const head = container.querySelector('[data-testid="portfolio-worst-first"]')!
    expect(head.querySelector('.sr-only')!.textContent).toContain('Worst first: glot.it (4 CI jobs failed today')
    const chips = head.querySelector('[aria-hidden="true"]')!
    expect([...chips.querySelectorAll('[data-testid^="worst-chip-"]')].map((c) => c.getAttribute('data-testid'))).toEqual(['worst-chip-glot', 'worst-chip-yen', 'worst-chip-twm'])
    const yen = chips.querySelector('[data-testid="worst-chip-yen"]')!
    expect(yen.querySelector('.truncate')!.textContent).toBe('yen-yen')
    expect(yen.querySelector('.font-mono')!.textContent).toBe('12')
    expect(chips.textContent).toContain('+1 more')
    expect(chips.textContent).not.toContain('open bugs')
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

describe('the public demo (keep-but-hide)', () => {
  const DEMO = card({ projectId: 'demo', name: 'Mushi demo (sample data)', slug: 'mushi-demo', openReports: 4 })
  const group = (ruleId: string, projectIds: string[]) => ({
    ruleId, title: null, gate: 'radar', gateLabel: null, severity: 'warn' as const, projectIds, findingCount: projectIds.length, sampleMessage: 'x', suggestedFix: 'y',
  })

  it('is in no per-app list on the Apps tab, and leaves no loose line under the grid', async () => {
    state.data = portfolio([...CARDS, DEMO])
    state.findings = {
      ...NO_FINDINGS,
      groups: [group('spend_cap_unset', ['glot', 'yen', 'demo']), group('key_unused_90d', ['twm', 'demo'])],
      sdkSkew: [
        { projectId: 'demo', package: null, version: null, latest: null, status: 'unknown', reason: 'No Mushi SDK has reported from this project yet.' },
        { projectId: 'yen', package: '@mushi-mushi/web', version: '1.0.0', latest: '1.1.0', status: 'behind', reason: '' },
      ],
      holes: [{ projectId: 'demo', integration: 'github', siblingsWith: 5, reason: '' }, { projectId: 'demo', integration: 'sentry', siblingsWith: 5, reason: '' }, { projectId: 'twm', integration: 'sentry', siblingsWith: 5, reason: '' }],
    }
    await render()
    expect(container.querySelector('[data-testid="heat-row-demo"]')).toBeNull()
    expect(container.querySelector('[data-testid="portfolio-public-demo"]')).toBeNull()
    expect(container.textContent).not.toContain('powers the docs')
    // Fix once: no demo column or dot, and a problem left in one app is not "fix once".
    expect(container.querySelector('[data-testid="fix-once-col-demo"]')).toBeNull()
    expect(container.querySelector('[data-app="demo"]')).toBeNull()
    expect(container.querySelector('[data-testid="fix-once-item-key_unused_90d"]')).toBeNull()
    expect(container.querySelector('[data-testid="fix-once-item-spend_cap_unset"]')).not.toBeNull()
    // SDK versions and Missing setups: no row that only the demo had.
    expect(container.querySelector('[data-testid="sdk-row-unknown"]')).toBeNull()
    expect(container.querySelector('[data-testid="hole-row-github"]')).toBeNull()
    expect(container.querySelector('[data-testid="hole-row-sentry"] [data-testid="app-icon-chips"]')!.getAttribute('data-count')).toBe('1')
    // The header's Fix once count follows what the page shows, not the server's raw count.
    expect(container.querySelector('[data-testid="page-status"]')!.textContent).toContain('Fix once1')
  })
})

describe('Spend and accounts', () => {
  it("keeps what the accounts register is in the page's help, not a paragraph on the card", async () => {
    await render('/portfolio?tab=spend')
    const help = text('[data-testid="help-what"]')
    expect(help).toContain('Accounts and resilience')
    expect(help).toContain('who else can get in if that person cannot')
    expect(help).toContain("cannot see a provider's own settings")
  })
})

describe('Apps tabs', () => {
  const shown = () => [...container.querySelectorAll('[data-testid^="portfolio-tab-"]')].map((el) => el.getAttribute('data-testid'))
  const tabLink = (label: string) => [...container.querySelectorAll<HTMLAnchorElement>('[role="tab"]')].find((a) => a.textContent === label)!
  const location = () => text('[data-testid="location"]')

  it('shows one section at a time, Apps by default', async () => {
    await render()
    expect(shown()).toEqual(['portfolio-tab-apps'])
    expect(container.querySelector('[data-testid="portfolio-signal-grid"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="mock-MonetizationCard"]')).toBeNull()
    expect(tabLink('Apps').getAttribute('aria-selected')).toBe('true')
    // The alerts and the ranking stay above the tabs.
    expect(container.querySelector('[data-testid="portfolio-alert-glot"]')).not.toBeNull()
  })

  it('?tab=payments shows only Payments, and every tab keeps the other params', async () => {
    await render('/portfolio?group=work&tab=payments')
    expect(shown()).toEqual(['portfolio-tab-payments'])
    expect(container.querySelector('[data-testid="mock-MonetizationCard"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="portfolio-signal-grid"]')).toBeNull()
    expect(container.querySelector('[data-testid="mock-SpendLedgerCard"]')).toBeNull()
    expect(tabLink('Payments').getAttribute('aria-selected')).toBe('true')
    expect(tabLink('Releases').getAttribute('href')).toBe('/portfolio?group=work&tab=releases')
    // Apps is the default: its link drops the param instead of spelling it.
    expect(tabLink('Apps').getAttribute('href')).toBe('/portfolio?group=work')
  })

  it('an unknown tab falls back to Apps', async () => {
    await render('/portfolio?tab=nope')
    expect(shown()).toEqual(['portfolio-tab-apps'])
    expect(tabLink('Apps').getAttribute('aria-selected')).toBe('true')
  })

  it('clicking a tab updates the URL, and back returns to the tab before', async () => {
    await render()
    await act(async () => tabLink('Spend & accounts').click())
    expect(location()).toBe('/portfolio?tab=spend')
    expect(shown()).toEqual(['portfolio-tab-spend'])
    expect(container.querySelector('[data-testid="mock-SpendLedgerCard"]')).not.toBeNull()
    await act(async () => tabLink('Digest').click())
    expect(shown()).toEqual(['portfolio-tab-digest'])
    await act(async () => nav.go!(-1))
    expect(location()).toBe('/portfolio?tab=spend')
    expect(shown()).toEqual(['portfolio-tab-spend'])
    await act(async () => nav.go!(-1))
    expect(location()).toBe('/portfolio')
    expect(shown()).toEqual(['portfolio-tab-apps'])
    await act(async () => nav.go!(1))
    expect(shown()).toEqual(['portfolio-tab-spend'])
  })
})
