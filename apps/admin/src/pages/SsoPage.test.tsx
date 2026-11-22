/**
 * @vitest-environment jsdom
 */

/**
 * Console audit 2026-11-21, Team → Single sign-on on a plan without SSO: a
 * status banner with "View plans", an "SSO SNAPSHOT" of four zero tiles
 * ("GoTrue registration state") and the upgrade panel with a second "View
 * plans". A locked plan now shows the upgrade panel alone.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ unlocked: false }))

vi.mock('../lib/supabase', () => ({ apiFetch: vi.fn(async () => ({ ok: true })) }))
vi.mock('../lib/usePageData', () => ({
  usePageData: () => ({ data: null, reload: vi.fn(), lastFetchedAt: null, isValidating: false, loading: false, error: null }),
}))
vi.mock('../lib/useEntitlements', () => ({
  useEntitlements: () => ({ has: () => mocks.unlocked, loading: false, planName: 'Studio' }),
}))
vi.mock('../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: () => null }))
vi.mock('../components/billing/UpgradePrompt', () => ({
  UpgradePrompt: () => createElement('div', { 'data-testid': 'upgrade-prompt' }, 'Locked on your current plan'),
}))
vi.mock('../components/sso/SsoStatusBanner', () => ({
  SsoStatusBanner: () => createElement('div', { 'data-testid': 'sso-status-banner' }),
}))
vi.mock('../components/sso/SsoSnapshotStrip', () => ({
  SsoSnapshotStrip: () => createElement('div', { 'data-testid': 'sso-snapshot' }),
}))
vi.mock('../components/sso/SsoProtocolGuide', () => ({
  SsoProtocolGuide: () => createElement('div', { 'data-testid': 'sso-guide' }),
}))
vi.mock('../components/sso/SsoReadout', () => ({ SsoReadout: () => null }))

import { SsoPage } from './SsoPage'

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

function render() {
  act(() => root.render(createElement(MemoryRouter, null, createElement(SsoPage))))
}

describe('SsoPage on a plan without SSO', () => {
  it('shows only the upgrade panel', () => {
    mocks.unlocked = false
    render()
    expect(host.querySelector('[data-testid="upgrade-prompt"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="sso-status-banner"]')).toBeNull()
    expect(host.querySelector('[data-testid="sso-snapshot"]')).toBeNull()
    expect(host.querySelector('[data-testid="sso-guide"]')).toBeNull()
  })

  it('keeps the status banner and snapshot once SSO is unlocked', () => {
    mocks.unlocked = true
    render()
    expect(host.querySelector('[data-testid="upgrade-prompt"]')).toBeNull()
    expect(host.querySelector('[data-testid="sso-status-banner"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="sso-snapshot"]')).not.toBeNull()
  })
})
