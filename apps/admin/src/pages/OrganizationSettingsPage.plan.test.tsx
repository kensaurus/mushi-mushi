/**
 * @vitest-environment jsdom
 *
 * Team page: a complimentary org showed a green "Pro" chip and
 * "You're on Pro with N seats left". The chip, the seat sentence, and the
 * tooltip now match the header and the sidebar.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_MEMBERS_STATS } from '../components/members/types'
import { visiblePlanTitle } from '../lib/visiblePlanLabel'

const ORG_ID = '11111111-1111-4111-8111-111111111111'

vi.mock('../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    const base = {
      reload: vi.fn(),
      lastFetchedAt: null,
      isValidating: false,
      loading: false,
      error: null,
      errorCode: null,
      errorMessage: null,
      requestId: null,
      errorEndpoint: null,
    }
    if (!path) return { ...base, data: null }
    if (path.endsWith('/members/stats')) {
      return {
        ...base,
        data: {
          ...EMPTY_MEMBERS_STATS,
          planId: 'pro',
          planDisplayName: 'Pro',
          billingMode: 'complimentary',
          seatLimit: 5,
          seatsUsed: 3,
          seatsRemaining: 2,
          teamsEnabled: true,
        },
      }
    }
    if (path.endsWith('/members')) {
      return {
        ...base,
        data: {
          organization: { id: ORG_ID, slug: 'kenji', name: 'kenji', plan_id: 'pro', billing_mode: 'complimentary' },
          currentUserRole: 'owner',
          members: [],
          invitations: [],
        },
      }
    }
    if (path.includes('entitlements')) {
      return {
        ...base,
        data: { planId: 'pro', planName: 'Pro', featureFlags: { teams: true }, hasProject: true },
      }
    }
    return { ...base, data: null }
  },
}))

vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../lib/track', () => ({ trackSelf: vi.fn(), trackAdHoc: vi.fn() }))

import { OrganizationSettingsPage } from './OrganizationSettingsPage'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  window.matchMedia = (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('Team page plan label', () => {
  it('shows Pro (complimentary) on the chip and in the seat sentence, with the shared tooltip', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [`/?org=${ORG_ID}`] },
          createElement(OrganizationSettingsPage),
        ),
      )
    })
    const expected = visiblePlanTitle({ displayName: 'Pro', planId: 'pro', billingMode: 'complimentary' })
    const chip = [...host.querySelectorAll('span')].find((el) => el.textContent === 'Pro (complimentary)')
    expect(chip).toBeTruthy()
    expect(chip?.getAttribute('title')).toBe(expected)
    expect(chip?.className).toContain('bg-brand-subtle')
    expect(chip?.className).not.toContain('okSubtle')
    expect(host.textContent).toContain("You're on Pro (complimentary) with 2 seats left")
    expect(host.textContent).not.toMatch(/\bCOMP\b/)
  })
})
