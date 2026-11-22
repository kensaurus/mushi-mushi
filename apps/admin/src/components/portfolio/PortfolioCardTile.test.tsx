/**
 * @vitest-environment jsdom
 *
 * A Portfolio card names its own top problem: a chip that differs between
 * apps and one next step to the page that fixes it. Mushi's setup chore (no
 * spend cap) is never the next step while the app has open bugs.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The icon is not under test, and its resolver needs a built @mushi-mushi/core.
vi.mock('../ProjectFavicon', () => ({ ProjectFavicon: () => null }))

import type { PortfolioCard } from '../../lib/portfolioTypes'
import { PortfolioCardTile, PortfolioCompactRow } from './PortfolioCardTile'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const card = (over: Partial<PortfolioCard>): PortfolioCard => ({
  projectId: 'p1',
  name: 'yen-yen',
  slug: 'yen-yen',
  kind: 'app',
  kindSource: 'declared',
  worst: 'drift',
  elements: {},
  error: null,
  needsLook: [
    {
      element: 'gates',
      label: 'Automated checks',
      state: 'drift',
      reason: '1 problem to fix: Mushi setup check (1). They and their fixes are under Risk checks on the Recipe page.',
    },
  ],
  openReports: 29,
  sdk: [],
  latestRelease: null,
  radar: { checkedAt: '2026-10-26T00:00:00Z', status: 'pass', open: { error: 0, warn: 0, info: 0 }, unchecked: 0, errored: 0 },
  spend: { llmUsd30d: 0, llmCalls30d: 0, partial: false, autofixCapUsd: null, monthlyLlmBudgetUsd: null, capsKnown: true },
  unreadable: [],
  ...over,
})

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

function render(node: ReturnType<typeof createElement>) {
  act(() => root.render(createElement(MemoryRouter, null, node)))
}

const favicon = { project_id: 'p1', project_name: 'yen-yen', project_slug: 'yen-yen' }

describe('PortfolioCardTile', () => {
  it('leads with the open bugs, not the Mushi setup chore', () => {
    render(createElement(PortfolioCardTile, { card: card({}), favicon, showSpend: false }))
    expect(host.textContent).toContain('Bugs to fix')
    expect(host.textContent).not.toContain('Needs attention')
    const next = host.querySelector('[data-testid="portfolio-next-step"]') as HTMLAnchorElement
    expect(next.textContent).toContain('Fix the worst of 29 open bugs')
    expect(next.getAttribute('href')).toBe('/reports?project=p1')
  })

  it('names a failing part in the chip and links to its page', () => {
    render(
      createElement(PortfolioCardTile, {
        card: card({ openReports: 0, needsLook: [{ element: 'ci', label: 'CI', state: 'error', reason: 'Mushi could not read your CI builds.' }] }),
        favicon,
        showSpend: false,
      }),
    )
    expect(host.textContent).toContain('CI failing')
    expect((host.querySelector('[data-testid="portfolio-next-step"]') as HTMLAnchorElement).getAttribute('href')).toBe('/ci?project=p1')
  })
})

describe('PortfolioCompactRow', () => {
  it('shows the chore an app without urgent problems still has', () => {
    render(createElement('ul', null, createElement(PortfolioCompactRow, { card: card({ openReports: 0 }), favicon })))
    expect(host.textContent).toContain('Mushi setup')
  })
})

describe("links open the card's own app", () => {
  // Owner, 2026-11-17: in "All apps" mode every link on the kensaur.us card
  // opened the app picked before it (the URL kept the old ?project=).
  const OLD = '11111111-1111-4111-8111-111111111111'
  const MINE = '22222222-2222-4222-8222-222222222222'

  function Probe() {
    const loc = useLocation()
    return createElement('output', { 'data-testid': 'probe' }, `${loc.pathname}${loc.search}`)
  }

  function renderAt(node: ReturnType<typeof createElement>) {
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [`/portfolio?project=${OLD}&apps=all`] },
          createElement(Routes, null,
            createElement(Route, { path: '/portfolio', element: node }),
            createElement(Route, { path: '*', element: createElement(Probe) }),
          ),
        ),
      ),
    )
  }

  const where = () => new URLSearchParams((host.querySelector('[data-testid="probe"]')?.textContent ?? '').split('?')[1] ?? '')

  beforeEach(() => {
    window.localStorage.setItem('mushi:active_project_id', OLD)
    window.localStorage.setItem('mushi:project_scope', 'all')
  })
  afterEach(() => window.localStorage.clear())

  const mine = () => card({ projectId: MINE, name: 'kensaur.us' })
  const click = (el: Element | null) => act(() => (el as HTMLElement).click())

  it.each([
    ['a status chip', () => host.querySelector('[aria-label="Status"] a')],
    ['the next step', () => host.querySelector('[data-testid="portfolio-next-step"]')],
    ['the Blueprint footer link', () => [...host.querySelectorAll('a')].find((a) => a.textContent === 'Blueprint') ?? null],
    ['the app name', () => host.querySelector('h3 a')],
  ])("%s navigates with that card's project and leaves All apps", (_label, find) => {
    renderAt(createElement(PortfolioCardTile, { card: mine(), favicon, showSpend: false }))
    click(find())
    expect(where().get('project')).toBe(MINE)
    expect(where().has('apps')).toBe(false)
    expect(window.localStorage.getItem('mushi:active_project_id')).toBe(MINE)
    expect(window.localStorage.getItem('mushi:project_scope')).toBeNull()
  })

  it('the compact row does the same', () => {
    renderAt(createElement('ul', null, createElement(PortfolioCompactRow, { card: mine(), favicon })))
    click(host.querySelector('a'))
    expect(where().get('project')).toBe(MINE)
    expect(where().has('apps')).toBe(false)
  })
})
