/**
 * @vitest-environment jsdom
 *
 * Header team pill: a complimentary org rendered "comp", which CSS uppercased
 * to COMP. The pill now shows the same label, casing, and tooltip as the
 * Team page and the sidebar.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { visiblePlanTitle } from '../lib/visiblePlanLabel'

const ORG_ID = '11111111-1111-4111-8111-111111111111'

const mocks = vi.hoisted(() => ({
  organizations: [] as Array<Record<string, unknown>>,
}))

vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({
    data: { organizations: mocks.organizations },
    loading: false,
    error: null,
    reload: vi.fn(),
    lastFetchedAt: null,
    isValidating: false,
  }),
}))

vi.mock('../lib/useCreateOrganization', () => ({
  useCreateOrganization: () => ({ create: vi.fn(), creating: false }),
}))

import { OrgSwitcher } from './OrgSwitcher'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('OrgSwitcher plan label', () => {
  it('renders Pro (complimentary) in the written case with the shared tooltip', async () => {
    mocks.organizations = [{
      id: ORG_ID,
      slug: 'kenji',
      name: 'kenji',
      plan_id: 'pro',
      plan_display_name: 'Pro',
      billing_mode: 'complimentary',
      role: 'owner',
    }]
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(OrgSwitcher)))
    })
    const button = host.querySelector('button')
    const expected = visiblePlanTitle({ displayName: 'Pro', planId: 'pro', billingMode: 'complimentary' })
    const badge = [...host.querySelectorAll('span')].find((el) => el.textContent === 'Pro (complimentary)')
    expect(button?.textContent).toContain('kenji')
    expect(button?.textContent).toContain('Pro (complimentary)')
    expect(button?.textContent).not.toMatch(/\bcomp\b/i)
    expect(button?.getAttribute('title')).toBe(expected)
    expect(badge?.className).toContain('normal-case')
    expect(badge?.className).not.toMatch(/\buppercase\b/)
    expect(badge?.className).toContain('bg-brand-subtle')

    button?.click()
    await act(async () => {})
    expect(host.textContent).toContain('owner · Pro (complimentary)')
  })
})
