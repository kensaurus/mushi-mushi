/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/rewards/tabs/panels.groupK.test.tsx
 * PURPOSE: Rewards → Settings regressions from console group K (2026-10-04):
 *   - entry 9: "Add provider" crashed the tab (/v1/admin/projects is an object);
 *   - entry 8: the auto-generated webhook signing secret was never shown;
 *   - entry 62: Remove webhook fired with one click.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pages: {} as Record<string, unknown>,
  apiFetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../../../lib/usePageData', () => ({
  usePageData: (path: string | null) => ({
    data: path ? (mocks.pages[path] ?? null) : null,
    loading: false,
    error: null,
    reload: vi.fn(),
    lastFetchedAt: null,
    isValidating: false,
  }),
}))
vi.mock('../../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../../lib/realtime', () => ({ useRealtimeReload: () => {} }))
vi.mock('../../../lib/useEntitlements', () => ({ useEntitlements: () => ({ has: () => false }) }))
vi.mock('../../../lib/toast', () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError, info: vi.fn(), warn: vi.fn() }),
}))

import { IdentityProvidersSection, SettingsTab } from './panels'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.pages = {
    '/v1/admin/rewards/identity-providers': [],
    '/v1/admin/projects': { projects: [{ id: 'p-1', name: 'Shop app' }], admin_host: 'x', latest_sdk_versions: {} },
    '/v1/admin/rewards/webhooks': [],
    '/v1/admin/rewards/payouts': [],
    '/v1/admin/rewards/disputes': [],
  }
  mocks.apiFetch.mockReset()
  mocks.toastSuccess.mockReset()
  mocks.toastError.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

async function render(el: ReturnType<typeof createElement>): Promise<void> {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, el))
  })
}

function button(label: RegExp): HTMLButtonElement {
  const b = Array.from(document.body.querySelectorAll('button')).find(
    (el) => label.test(el.textContent ?? '') || label.test(el.getAttribute('aria-label') ?? ''),
  )
  if (!b) throw new Error(`no button ${label}`)
  return b
}

async function typeInto(el: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('IdentityProvidersSection', () => {
  it('opens the Add provider form and lists projects from the { projects } payload', async () => {
    await render(createElement(IdentityProvidersSection, { canEdit: true }))
    await act(async () => button(/Add provider/).click())
    const options = Array.from(container.querySelectorAll('option')).map((o) => o.textContent)
    expect(options).toContain('Shop app')
  })
})

describe('SettingsTab webhooks', () => {
  it('shows the auto-generated signing secret once after creating a webhook', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      data: { id: 'w-1', url: 'https://app.example/hook' },
      meta: { secret: 'mushi_whk_onetime123', secret_shown_once: true, vaulted: true },
    })
    await render(createElement(SettingsTab, { canEdit: true }))
    await act(async () => button(/Add webhook/).click())
    const url = container.querySelector<HTMLInputElement>('input[placeholder^="https://yourapp.com"]')!
    await typeInto(url, 'https://app.example/hook')
    await act(async () => button(/^Save$/).click())

    const reveal = container.querySelector('[data-testid="reward-webhook-secret-reveal"]')
    expect(reveal?.textContent).toContain('mushi_whk_onetime123')
    expect(reveal?.textContent).toMatch(/won't see it again/)
    // Blocked from the console's own bug-report screenshots.
    expect(reveal?.querySelector('[data-auth-token]')?.textContent).toContain('mushi_whk_onetime123')

    await act(async () => button(/I've stored it/).click())
    expect(container.textContent).not.toContain('mushi_whk_onetime123')
  })

  it('asks before removing a webhook and only deletes after confirming', async () => {
    mocks.pages['/v1/admin/rewards/webhooks'] = [
      { id: 'w-1', url: 'https://app.example/hook', events: ['reward.tier_changed'], enabled: true, last_delivered_at: null, last_status: null },
    ]
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { deleted: true } })
    await render(createElement(SettingsTab, { canEdit: true }))
    await act(async () => button(/Remove webhook https:\/\/app\.example\/hook/).click())
    expect(mocks.apiFetch).not.toHaveBeenCalled()

    await act(async () => button(/^Remove webhook$/).click())
    expect(mocks.apiFetch).toHaveBeenCalledWith('/v1/admin/rewards/webhooks/w-1', { method: 'DELETE' })
  })

  it('reports a failed delete instead of staying silent', async () => {
    mocks.pages['/v1/admin/rewards/webhooks'] = [
      { id: 'w-1', url: 'https://app.example/hook', events: [], enabled: true, last_delivered_at: null, last_status: null },
    ]
    mocks.apiFetch.mockResolvedValue({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Failed to fetch' } })
    await render(createElement(SettingsTab, { canEdit: true }))
    await act(async () => button(/Remove webhook https/).click())
    await act(async () => button(/^Remove webhook$/).click())
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })
})
