/**
 * @vitest-environment jsdom
 *
 * Where an AI key is used. A Firecrawl key had to be pasted into each app
 * (2026-10-10), so a key can be shared by every app in the organization (ADR
 * 0023); one Anthropic key still could not serve apps in two organizations
 * (2026-10-21), so a key can also serve every app its owner owns: "All my
 * apps", the default for new keys (ADR 0031).
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
  addedByMe: true,
}
const SHARED = { ...OWN, id: 'key-shared', key_hint: '…9999', scope: 'organization' }
const MINE = { ...OWN, id: 'key-mine', key_hint: '…1111', scope: 'universal', ownedByMe: true, servesThisApp: true }
const THEIRS = { ...OWN, id: 'key-theirs', key_hint: '…2222', scope: 'universal', ownedByMe: false, servesThisApp: true }

const OWNER_SHARING = { organizationName: 'kenji', appCount: 9, canManage: true }
const OWNER_UNIVERSAL = { canAdd: true, appCount: 12, organizationCount: 2 }

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  reload: vi.fn(),
  keys: [] as unknown[],
  sharing: null as null | { organizationName: string; appCount: number; canManage: boolean },
  universal: null as null | { canAdd: boolean; appCount: number; organizationCount: number },
}))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/useEntitlements', () => ({
  useEntitlements: () => ({ loading: false, has: () => true, planName: 'Studio' }),
  isByokLocked: () => false,
}))
vi.mock('./ByokPoolContext', () => ({
  useByokPool: () => ({
    data: { keys: mocks.keys, legacyKeys: [], sharing: mocks.sharing, universal: mocks.universal },
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
/** A segment of a SegmentedControl, inside `within` when given. */
function radio(label: string, within: ParentNode = document.body): HTMLButtonElement {
  const r = Array.from(within.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent?.trim() === label)
  if (!r) throw new Error(`no option "${label}"`)
  return r
}
const calls = (path: string, method: string) =>
  mocks.apiFetch.mock.calls.filter(([url, init]) => url === path && (init as RequestInit)?.method === method)
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body))
const firecrawlRow = () => document.getElementById('key-firecrawl')!
const keyRow = (hint: string) =>
  Array.from(document.body.querySelectorAll('li')).find((li) => li.textContent?.includes(hint))!

async function typeInto(el: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function openFirecrawlForm() {
  const open = Array.from(firecrawlRow().querySelectorAll('button')).find((b) => b.getAttribute('aria-expanded') !== null)!
  await act(async () => open.click())
}

async function confirmDialog(label: string) {
  const confirm = buttons().filter((b) => b.textContent?.trim() === label).pop()!
  await act(async () => confirm.click())
}

describe('ByokPanel key scope', () => {
  let container: HTMLDivElement
  let root: Root

  async function render() {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ByokPanel)))
    })
  }

  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: { validation: { status: 'ok' } } })
    mocks.keys = []
    mocks.sharing = OWNER_SHARING
    mocks.universal = OWNER_UNIVERSAL
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  describe('the add form', () => {
    it('starts on "All my apps", offers the three scopes in plain words, and explains the order', async () => {
      await render()
      await openFirecrawlForm()
      const options = Array.from(firecrawlRow().querySelectorAll('[role="radio"]')).map((r) => r.textContent?.trim())
      expect(options).toEqual(['All my apps', 'This organization', 'This app only'])
      expect(radio('All my apps', firecrawlRow()).getAttribute('aria-checked')).toBe('true')
      expect(firecrawlRow().textContent).toContain('all 12 apps you own in your 2 organizations')
      expect(firecrawlRow().textContent).toContain(
        "Each app tries its own key first, then its organization's, then an all-apps key, then Mushi's own.",
      )
    })

    it('sends scope universal by default', async () => {
      await render()
      await openFirecrawlForm()
      await typeInto(firecrawlRow().querySelector('input')!, 'fc-FAKE-universal-0001')
      await act(async () => button('Save & validate').click())
      expect(bodyOf(calls('/v1/admin/byok/keys', 'POST')[0]!)).toMatchObject({ provider: 'firecrawl', scope: 'universal' })
    })

    it('sends the scope the owner picks', async () => {
      await render()
      await openFirecrawlForm()
      await act(async () => radio('This app only', firecrawlRow()).click())
      expect(firecrawlRow().textContent).toContain('Only this app uses it.')
      await typeInto(firecrawlRow().querySelector('input')!, 'fc-FAKE-universal-0001')
      await act(async () => button('Save & validate').click())
      expect(bodyOf(calls('/v1/admin/byok/keys', 'POST')[0]!)).toMatchObject({ scope: 'project' })
    })

    it('an admin who does not own the organization starts on "This organization", without "All my apps"', async () => {
      mocks.universal = { canAdd: false, appCount: 3, organizationCount: 1 }
      await render()
      await openFirecrawlForm()
      const options = Array.from(firecrawlRow().querySelectorAll('[role="radio"]')).map((r) => r.textContent?.trim())
      expect(options).toEqual(['This organization', 'This app only'])
      expect(radio('This organization', firecrawlRow()).getAttribute('aria-checked')).toBe('true')
    })

    it('a member adds to this app only, with no picker', async () => {
      mocks.universal = { canAdd: false, appCount: 0, organizationCount: 0 }
      mocks.sharing = { ...OWNER_SHARING, canManage: false }
      await render()
      await openFirecrawlForm()
      expect(firecrawlRow().querySelectorAll('[role="radio"]')).toHaveLength(0)
    })

    it('a Supabase token offers no scope picker', async () => {
      await render()
      const row = document.getElementById('key-supabase')!
      const open = Array.from(row.querySelectorAll('button')).find((b) => b.getAttribute('aria-expanded') !== null)!
      await act(async () => open.click())
      expect(row.querySelectorAll('[role="radio"]')).toHaveLength(0)
    })
  })

  describe('key rows', () => {
    it('each key shows its scope chip', async () => {
      mocks.keys = [OWN, SHARED, MINE, THEIRS]
      await render()
      expect(keyRow('…7270').textContent).toContain('This app only')
      expect(keyRow('…9999').textContent).toContain('All apps in kenji')
      expect(keyRow('…1111').textContent).toContain('All my apps')
      expect(keyRow('…2222').textContent).toContain("Owner's key, all their apps")
    })

    it('moves an app key to all my apps after confirming', async () => {
      mocks.keys = [OWN]
      await render()
      await act(async () => radio('All my apps', keyRow('…7270')).click())
      // Nothing moves until the dialog is confirmed.
      expect(calls('/v1/admin/byok/keys/key-own/scope', 'PATCH')).toHaveLength(0)
      expect(document.body.textContent).toContain('Use this key in all your apps?')
      await confirmDialog('Use in all my apps')
      const sent = calls('/v1/admin/byok/keys/key-own/scope', 'PATCH')
      expect(sent).toHaveLength(1)
      expect(bodyOf(sent[0]!)).toEqual({ scope: 'universal' })
    })

    it("a colleague's key cannot become my all-apps key, but can still move between app and organization", async () => {
      mocks.keys = [{ ...OWN, addedByMe: false }]
      await render()
      const options = Array.from(keyRow('…7270').querySelectorAll('[role="radio"]')).map((r) => r.textContent?.trim())
      expect(options).toEqual(['This organization', 'This app only'])
    })

    it('brings a universal key back to this app', async () => {
      mocks.keys = [MINE]
      await render()
      await act(async () => radio('This app only', keyRow('…1111')).click())
      expect(document.body.textContent).toContain('Your other apps stop using it')
      await confirmDialog('Use in this app only')
      expect(bodyOf(calls('/v1/admin/byok/keys/key-mine/scope', 'PATCH')[0]!)).toEqual({ scope: 'project' })
    })

    it('shares an app key with the organization', async () => {
      mocks.keys = [OWN]
      await render()
      await act(async () => radio('This organization', keyRow('…7270')).click())
      expect(document.body.textContent).toContain('Use this key in all 9 apps in kenji?')
      await confirmDialog('Use in this organization')
      expect(bodyOf(calls('/v1/admin/byok/keys/key-own/scope', 'PATCH')[0]!)).toEqual({ scope: 'organization' })
    })

    it("another owner's universal key is read-only", async () => {
      mocks.keys = [THEIRS]
      await render()
      expect(keyRow('…2222').textContent).toContain('Only they can change or remove it')
      expect(keyRow('…2222').querySelectorAll('[role="radio"]')).toHaveLength(0)
      expect(buttons().some((b) => b.textContent?.trim() === 'Turn off')).toBe(false)
    })

    it('says when my universal key does not serve this app', async () => {
      mocks.keys = [{ ...MINE, servesThisApp: false }]
      mocks.universal = { canAdd: false, appCount: 5, organizationCount: 1 }
      await render()
      expect(keyRow('…1111').textContent).toContain('Not used in this app')
    })

    it('a member sees the organization key but cannot change it', async () => {
      mocks.keys = [SHARED]
      mocks.sharing = { ...OWNER_SHARING, canManage: false }
      mocks.universal = null
      await render()
      expect(document.body.textContent).toContain('An owner or admin can change or remove it')
      expect(buttons().some((b) => b.textContent?.trim() === 'Turn off')).toBe(false)
      expect(document.body.querySelectorAll('[role="radio"]')).toHaveLength(0)
    })

    it('a Supabase token offers no scope change', async () => {
      mocks.keys = [{ ...OWN, provider_slug: 'supabase' }]
      await render()
      expect(keyRow('…7270').querySelectorAll('[role="radio"]')).toHaveLength(0)
    })

    it('no scope controls for an app outside an organization', async () => {
      mocks.keys = [OWN]
      mocks.sharing = null
      mocks.universal = { canAdd: false, appCount: 0, organizationCount: 0 }
      await render()
      expect(document.body.querySelectorAll('[role="radio"]')).toHaveLength(0)
    })
  })
})
