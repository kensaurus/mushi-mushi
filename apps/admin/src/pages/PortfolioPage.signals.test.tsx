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
