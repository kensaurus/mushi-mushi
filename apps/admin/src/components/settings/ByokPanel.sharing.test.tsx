/**
 * @vitest-environment jsdom
 *
 * AI keys shared by every app in the organization (ADR 0023). A Firecrawl key
 * had to be pasted into each app separately (2026-10-10); a key can now be
 * added once for all apps, or moved there from one app.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const OWN = {
  id: 'key-own',
  provider_slug: 'firecrawl',
  label: null,
  priority: 0,
  status: 'active',
  key_hint: '…7270',
  base_url: null,
  test_status: 'ok',
  last_tested_at: '2026-10-04T00:00:00Z',
  last_used_at: null,
  cooldown_until: null,
  created_at: '2026-10-04T00:00:00Z',
  scope: 'project',
}
const SHARED = { ...OWN, id: 'key-shared', key_hint: '…9999', scope: 'organization' }

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  reload: vi.fn(),
  keys: [] as unknown[],
  sharing: null as null | { organizationName: string; appCount: number; canManage: boolean },
}))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/useEntitlements', () => ({
  useEntitlements: () => ({ loading: false, has: () => true, planName: 'Pro' }),
}))
vi.mock('./ByokPoolContext', () => ({
  useByokPool: () => ({
    data: { keys: mocks.keys, legacyKeys: [], sharing: mocks.sharing },
    loading: false,
    error: null,
    reload: mocks.reload,
  }),
}))

import { ByokPanel } from './ByokPanel'

const buttons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
function button(text: string): HTMLButtonElement {
  const btn = buttons().find((b) => b.textContent?.trim() === text)
  if (!btn) throw new Error(`no button "${text}"`)
  return btn
}
const posts = (path: string) =>
  mocks.apiFetch.mock.calls.filter(([url, init]) => url === path && (init as RequestInit)?.method === 'POST')
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body))

describe('ByokPanel shared keys', () => {
  let container: HTMLDivElement
  let root: Root

  async function render() {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ByokPanel)))
    })
  }

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('an admin moves an app key to every app in one click', async () => {
    mocks.keys = [OWN]
    mocks.sharing = { organizationName: 'kenji', appCount: 9, canManage: true }
    await render()
    await act(async () => button('Use in all apps').click())
    const calls = posts('/v1/admin/byok/keys/key-own/scope')
    expect(calls).toHaveLength(1)
    expect(bodyOf(calls[0]!)).toEqual({ scope: 'organization' })
    expect(document.body.textContent).toContain('all 9 apps in kenji')
  })

  it('a shared key is labelled, and can be brought back to this app', async () => {
    mocks.keys = [SHARED]
    mocks.sharing = { organizationName: 'kenji', appCount: 9, canManage: true }
    await render()
    expect(document.body.textContent).toContain('All apps in kenji')
    await act(async () => button('Use in this app only').click())
    expect(bodyOf(posts('/v1/admin/byok/keys/key-shared/scope')[0]!)).toEqual({ scope: 'project' })
  })

  it('a member sees the shared key but cannot change it', async () => {
    mocks.keys = [SHARED]
    mocks.sharing = { organizationName: 'kenji', appCount: 9, canManage: false }
    await render()
    expect(document.body.textContent).toContain('An owner or admin can change or remove it')
    expect(buttons().some((b) => b.textContent?.trim() === 'Turn off')).toBe(false)
    expect(buttons().some((b) => b.textContent?.trim() === 'Use in this app only')).toBe(false)
  })

  it('no sharing controls for an app outside an organization', async () => {
    mocks.keys = [OWN]
    mocks.sharing = null
    await render()
    expect(buttons().some((b) => b.textContent?.trim() === 'Use in all apps')).toBe(false)
  })
})
