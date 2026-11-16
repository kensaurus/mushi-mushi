/**
 * @vitest-environment jsdom
 */

/**
 * Console journeys 2026-10-27: `/team?view=sso` and `?view=compliance`
 * silently rendered the Members view. A plan-gated view a link asks for now
 * says "Available on <plan>" with a link to the plans.
 */

import { StrictMode, act, createElement } from 'react'
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
import { TEAM_HUB, type PageHub } from '../lib/pageHubs'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  entitlements.value = {
    planId: 'pro',
    planName: 'Pro',
    isSuperAdmin: false,
    isOperator: false,
    loading: false,
    has: (flag: string): boolean => flag === 'teams',
  }
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
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
})

const HOME: PageHub = {
  path: '/dashboard',
  title: 'Home view',
  views: [
    { id: 'today', label: 'Today', legacyPath: null },
    { id: 'apps', label: 'Overview', legacyPath: '/overview' },
  ],
}

function page(title: string, body: string) {
  return createElement('div', null, createElement(PageHeaderBar, { title, showCopyLink: false }), createElement('p', null, body))
}

function follows(earlier: Node, later: Node): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('PageHubView tab placement', () => {
  async function renderHub(render: Record<string, () => ReturnType<typeof createElement>>) {
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/dashboard'] }, createElement(PageHubView, { hub: HOME, render })))
    })
  }

  it('renders the page title before the view tabs', async () => {
    await renderHub({
      today: () => page('Home', 'Today body'),
      apps: () => page('Overview', 'Overview body'),
    })
    const header = container.querySelector('[data-page-header]')!
    const title = header.querySelector('h2')!
    const tabs = container.querySelector('[data-testid="hub-view-tabs"]')!
    expect(title.textContent).toContain('Home')
    expect(header.contains(tabs)).toBe(true)
    expect(follows(title, tabs)).toBe(true)
    expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(1)
  })

  it('keeps the tabs on the first header when a page has two', async () => {
    await renderHub({
      today: () =>
        createElement(
          'div',
          null,
          createElement(PageHeaderBar, { title: 'Home', showCopyLink: false }),
          createElement(PageHeaderBar, { title: 'Nested', showCopyLink: false }),
          createElement('p', null, 'body'),
        ),
      apps: () => page('Overview', 'Overview body'),
    })
    const headers = container.querySelectorAll('[data-page-header]')
    const tabs = container.querySelector('[data-testid="hub-view-tabs"]')!
    expect(headers).toHaveLength(2)
    expect(headers[0].querySelector('h2')!.textContent).toContain('Home')
    expect(headers[0].contains(tabs)).toBe(true)
    expect(headers[1].contains(tabs)).toBe(false)
    expect(follows(headers[0].querySelector('h2')!, tabs)).toBe(true)
  })

  it('moves the tabs under the new view’s title', async () => {
    await renderHub({
      today: () => page('Home', 'Today body'),
      apps: () => page('Overview', 'Overview body'),
    })
    const overview = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent === 'Overview')!
    await act(async () => {
      overview.click()
    })
    expect(container.textContent).toContain('Overview body')
    expect(container.textContent).not.toContain('Today body')
    const header = container.querySelector('[data-page-header]')!
    const tabs = container.querySelector('[data-testid="hub-view-tabs"]')!
    expect(header.querySelector('h2')!.textContent).toContain('Overview')
    expect(header.contains(tabs)).toBe(true)
    expect(follows(header.querySelector('h2')!, tabs)).toBe(true)
  })

  it('keeps the tabs above the content when a view has no header, then moves them under a header that appears', async () => {
    let showHeader = false
    function View() {
      if (!showHeader) return createElement('p', { 'data-testid': 'skeleton' }, 'loading')
      return page('Home', 'body')
    }
    const render = { today: () => createElement(View), apps: () => createElement(View) }
    await renderHub(render)
    expect(container.querySelector('[data-page-header]')).toBeNull()
    expect(follows(container.querySelector('[data-testid="hub-view-tabs"]')!, container.querySelector('[data-testid="skeleton"]')!)).toBe(true)

    showHeader = true
    await renderHub(render)
    const header = container.querySelector('[data-page-header]')!
    const tabs = container.querySelector('[data-testid="hub-view-tabs"]')!
    expect(header.contains(tabs)).toBe(true)
    expect(follows(header.querySelector('h2')!, tabs)).toBe(true)
  })

  it('renders one tab row under StrictMode', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/dashboard'] },
          createElement(
            StrictMode,
            null,
            createElement(PageHubView, {
              hub: HOME,
              render: {
                today: () => page('Home', 'Today body'),
                apps: () => page('Overview', 'Overview body'),
              },
            }),
          ),
        ),
      )
    })
    expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-testid="hub-view-tabs"]')).toHaveLength(1)
    const header = container.querySelector('[data-page-header]')!
    expect(header.contains(container.querySelector('[data-testid="hub-view-tabs"]'))).toBe(true)
  })
})
