/**
 * @vitest-environment jsdom
 */

/**
 * The Apps page's tabs read their own routes at once (2026-11-18 live preview:
 * spend, ci/overview, digest, monetization and portfolio/resources all started
 * only after the portfolio read returned, about 7.9 s). The cards here are the
 * real ones and so is usePageData; only apiFetch is mocked, and the portfolio
 * read never answers until the test says so.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'o-reads'

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  resolvePortfolio: null as null | ((v: unknown) => void),
}))

vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: api.apiFetch,
  apiFetchMutate: vi.fn(() => new Promise(() => {})),
}))
vi.mock('../components/OrgSwitcher', () => ({ useActiveOrgId: () => ORG }))
vi.mock('../lib/projectGroups', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useProjectGroups: () => ({ data: { groups: [] }, loading: false, reload: () => {} }),
  readActiveGroup: () => null,
  writeActiveGroup: () => {},
}))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: ({ title }: { title: string }) => createElement('h1', null, title) }))

import { PortfolioPage } from './PortfolioPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  api.apiFetch.mockReset()
  api.resolvePortfolio = null
  api.apiFetch.mockImplementation((path: string) => {
    if (path === `/v1/admin/orgs/${ORG}/portfolio`) {
      return new Promise((resolve) => {
        api.resolvePortfolio = resolve
      })
    }
    if (path === '/v1/admin/workspace/projects') {
      return Promise.resolve({ ok: true, data: { teams: [], projects: [{ id: 'p1', name: 'glot.it', organizationId: ORG }] } })
    }
    // Every other read stays in flight: the test is about when it starts.
    return new Promise(() => {})
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const requested = () => api.apiFetch.mock.calls.map(([p]) => String(p))
const asked = (re: RegExp) => requested().some((p) => re.test(p))

async function render(entry: string) {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [entry] }, createElement(PortfolioPage)))
  })
}

describe('Apps page reads', () => {
  it('?tab=spend starts the Spend tab reads while the portfolio read is still running', async () => {
    await render('/portfolio?tab=spend')
    expect(asked(new RegExp(`/v1/admin/orgs/${ORG}/portfolio$`))).toBe(true)
    expect(api.resolvePortfolio).not.toBeNull()
    // The portfolio promise has not resolved, and the Spend tab's own reads are out.
    expect(asked(new RegExp(`/orgs/${ORG}/spend$`))).toBe(true)
    expect(asked(new RegExp(`/orgs/${ORG}/accounts$`))).toBe(true)
    expect(asked(new RegExp(`/orgs/${ORG}/portfolio/resources$`))).toBe(true)
    expect(asked(new RegExp(`/orgs/${ORG}/connectors$`))).toBe(true)
    expect(container.querySelector('[data-testid="portfolio-tab-spend"]')).not.toBeNull()
    // Other tabs' routes are not read, and neither is Fix once (an Apps-tab read).
    expect(asked(/\/monetization$/)).toBe(false)
    expect(asked(/\/digest/)).toBe(false)
    expect(asked(/ci\/overview/)).toBe(false)
    expect(asked(/\/releases$/)).toBe(false)
    expect(asked(/\/funnel$/)).toBe(false)
    expect(asked(/\/portfolio\/findings/)).toBe(false)
  })

  it('?tab=payments reads monetization before the portfolio answers, and nothing from Spend', async () => {
    await render('/portfolio?tab=payments')
    expect(api.resolvePortfolio).not.toBeNull()
    expect(asked(new RegExp(`/orgs/${ORG}/monetization$`))).toBe(true)
    expect(asked(/\/spend$/)).toBe(false)
    expect(asked(/\/connectors$/)).toBe(false)
  })

  it('the Apps tab reads Fix once beside the portfolio and lists the apps while it waits', async () => {
    await render('/portfolio')
    expect(asked(new RegExp(`/orgs/${ORG}/portfolio/findings$`))).toBe(true)
    expect(asked(/\/spend$/)).toBe(false)
    expect(container.querySelector('[data-testid="portfolio-loading-apps"]')?.textContent).toContain('glot.it')
  })
})
