/**
 * @vitest-environment jsdom
 */

/**
 * Console journeys 2026-10-27: `/team?view=sso` and `?view=compliance`
 * silently rendered the Members view. A plan-gated view a link asks for now
 * says "Available on <plan>" with a link to the plans.
 */

import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const entitlements = vi.hoisted(() => ({
  value: {
    planId: 'pro',
    planName: 'Pro',
    isSuperAdmin: false,
    isOperator: false,
    loading: false,
    has: (flag: string): boolean => flag === 'teams',
  },
}))

vi.mock('../lib/useEntitlements', () => ({ useEntitlements: () => entitlements.value }))
vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({
    data: {
      projects: [],
      free_limit_reports_per_month: 0,
      plans: [
        { id: 'pro', display_name: 'Pro', position: 2, monthly_price_usd: 49, active: true, feature_flags: { teams: true } },
        { id: 'enterprise', display_name: 'Enterprise', position: 3, monthly_price_usd: 0, active: true, feature_flags: { teams: true, sso: true, soc2: true } },
      ],
    },
    loading: false,
    error: null,
    reload: () => {},
  }),
}))

import { PageHubView } from './PageHubView'
import { PageHeaderBar } from './PageHeaderBar'
import { HOME_HUB, TEAM_HUB } from '../lib/pageHubs'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function renderAt(path: string) {
  const render = Object.fromEntries(TEAM_HUB.views.map((v) => [v.id, () => createElement('p', null, `${v.label} content`)]))
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(PageHubView, { hub: TEAM_HUB, render })))
  })
}

describe('PageHubView locked views', () => {
  it('shows "Available on <plan>" for ?view=sso instead of Members', async () => {
    await renderAt('/team?view=sso')
    expect(container.textContent).not.toContain('Members content')
    expect(container.textContent).toContain('Single sign-on is available on Enterprise')
    expect(container.textContent).toContain('You are on Pro.')
    const plans = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('See plans'))
    expect(plans?.getAttribute('href')).toBe('/team?view=billing&tab=plans')
  })

  it('does the same for ?view=compliance', async () => {
    await renderAt('/team?view=compliance')
    expect(container.textContent).toContain('Compliance is available on Enterprise')
  })

  it('still opens a view the plan includes', async () => {
    await renderAt('/team?view=billing')
    expect(container.textContent).toContain('Billing content')
    expect(container.querySelector('[data-testid="locked-hub-view"]')).toBeNull()
  })

  it('waits for entitlements instead of flashing the locked card', async () => {
    entitlements.value = { ...entitlements.value, loading: true, has: () => false }
    await renderAt('/team?view=sso')
    expect(container.querySelector('[data-testid="locked-hub-view"]')).toBeNull()
    expect(container.textContent).toContain('Loading')
  })

  it('keeps the view tabs above a view that has no page header', async () => {
    entitlements.value = {
      planId: 'pro',
      planName: 'Pro',
      isSuperAdmin: false,
      isOperator: false,
      loading: false,
      has: (flag: string) => flag === 'teams',
    }
    await renderAt('/team?view=billing')
    const tabs = container.querySelector('[data-testid="hub-view-tabs"]')
    const body = Array.from(container.querySelectorAll('p')).find((p) => p.textContent === 'Billing content')
    expect(tabs).not.toBeNull()
    expect(body).toBeTruthy()
    expect(follows(tabs!, body!)).toBe(true)
    expect(container.querySelectorAll('[data-testid="hub-view-tabs"]')).toHaveLength(1)
  })
})

function follows(earlier: Node, later: Node): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

function header(title: string) {
  return createElement(PageHeaderBar, { title, showCopyLink: false })
}

function homeRender(): Record<string, () => ReturnType<typeof createElement>> {
  return {
    today: () => header('Home'),
    apps: () => header('Overview'),
    users: () => createElement('p', null, 'Users'),
    funnels: () => createElement('p', null, 'Funnels'),
    insights: () => createElement('p', null, 'Insights'),
    growth: () => createElement('p', null, 'Growth'),
  }
}

describe('PageHubView tab order', () => {
  beforeEach(() => {
    entitlements.value = {
      planId: 'pro',
      planName: 'Pro',
      isSuperAdmin: false,
      isOperator: false,
      loading: false,
      has: (flag: string) => flag === 'teams',
    }
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
    })) as unknown as typeof window.matchMedia
  })

  async function renderHome(path: string, render = homeRender(), strict = false) {
    const hub = createElement(PageHubView, { hub: HOME_HUB, render })
    const page = createElement(MemoryRouter, { initialEntries: [path] }, strict ? createElement(StrictMode, null, hub) : hub)
    await act(async () => {
      root.render(page)
    })
  }

  it('renders the page title before the view tabs', async () => {
    await renderHome('/dashboard')
    const title = container.querySelector('h2')
    const tabs = container.querySelector('[data-testid="hub-view-tabs"]')
    expect(title?.textContent).toContain('Home')
    expect(tabs).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="hub-view-tabs"]')).toHaveLength(1)
    expect(follows(title!, tabs!)).toBe(true)
  })

  it('keeps the title ahead of the tabs after switching views', async () => {
    await renderHome('/dashboard')
    const overview = Array.from(container.querySelectorAll('[role="radio"]')).find((b) => b.textContent === 'Overview')
    expect(overview).toBeTruthy()
    await act(async () => {
      ;(overview as HTMLButtonElement).click()
    })
    const title = container.querySelector('h2')
    const tabs = container.querySelector('[data-testid="hub-view-tabs"]')
    expect(title?.textContent).toContain('Overview')
    expect(follows(title!, tabs!)).toBe(true)
    expect(container.querySelectorAll('[data-testid="hub-view-tabs"]')).toHaveLength(1)
  })

  it('puts the strip under the first header when a view has two', async () => {
    await renderHome('/dashboard', {
      ...homeRender(),
      today: () => createElement('div', null, header('Home'), header('Also')),
    })
    const titles = Array.from(container.querySelectorAll('h2'))
    const tabs = container.querySelector('[data-testid="hub-view-tabs"]')
    expect(titles.map((t) => t.textContent)).toEqual(['Home', 'Also'])
    expect(container.querySelectorAll('[data-testid="hub-view-tabs"]')).toHaveLength(1)
    expect(follows(titles[0], tabs!)).toBe(true)
    expect(follows(tabs!, titles[1])).toBe(true)
  })

  it('still renders a single strip under the title in StrictMode', async () => {
    await renderHome('/dashboard', homeRender(), true)
    const title = container.querySelector('h2')
    const tabs = container.querySelector('[data-testid="hub-view-tabs"]')
    expect(title?.textContent).toContain('Home')
    expect(container.querySelectorAll('[data-testid="hub-view-tabs"]')).toHaveLength(1)
    expect(follows(title!, tabs!)).toBe(true)
  })

  it('moves the tabs back above a view that has no header', async () => {
    await renderHome('/dashboard?view=users')
    const tabs = container.querySelector('[data-testid="hub-view-tabs"]')
    const body = Array.from(container.querySelectorAll('p')).find((p) => p.textContent === 'Users')
    expect(container.querySelector('h2')).toBeNull()
    expect(follows(tabs!, body!)).toBe(true)
  })
})
