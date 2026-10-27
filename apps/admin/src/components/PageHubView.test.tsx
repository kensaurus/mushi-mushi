/**
 * @vitest-environment jsdom
 */

/**
 * Console journeys 2026-10-27: `/team?view=sso` and `?view=compliance`
 * silently rendered the Members view. A plan-gated view a link asks for now
 * says "Available on <plan>" with a link to the plans.
 */

import { act, createElement } from 'react'
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
import { TEAM_HUB } from '../lib/pageHubs'

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
})
