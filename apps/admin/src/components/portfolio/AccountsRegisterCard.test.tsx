/**
 * @vitest-environment jsdom
 */

/**
 * AccountsRegisterCard: shows the register's open rules, lets owners add an
 * account and declare a domain's auto-renew, hides editing from members, and
 * downloads the Markdown export through an authenticated fetch (a plain link
 * would not carry the session).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountsRegisterResponse } from './accountsRegisterView'

const ORG = 'org-1'
const DATA: AccountsRegisterResponse = {
  organizationId: ORG,
  canEdit: true,
  accounts: [{ id: 'a1', externalId: 'apple:kenji ltd', provider: 'apple', name: 'Kenji Ltd', ownerEmail: 'k@example.com', twoFactorDeclared: true, recoveryContact: null, adminCount: 1, autoRenew: null }],
  domains: [{ id: 'd1', domain: 'glot.it', autoRenew: null }],
  findings: [{ ruleId: 'account_single_owner', severity: 'warn', resourceKey: 'account:apple:kenji ltd', message: 'Apple Developer account "Kenji Ltd" has one person who can sign in.', suggestedFix: 'Invite a second Admin.' }],
}

const mocks = vi.hoisted(() => ({
  data: null as AccountsRegisterResponse | null,
  mutate: vi.fn(async () => ({ ok: true, data: { id: 'new' } })),
  raw: vi.fn(async () => new Response('# Accounts and resilience register', { status: 200 })),
  reload: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ apiFetchMutate: mocks.mutate, apiFetchRaw: mocks.raw }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: mocks.data, loading: false, error: null, reload: mocks.reload }),
}))

import { AccountsRegisterCard } from './AccountsRegisterCard'

let root: Root | null = null
let host: HTMLDivElement | null = null

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function button(text: string): HTMLButtonElement {
  const b = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent?.trim() === text)
  if (!b) throw new Error(`no button "${text}"`)
  return b
}

async function render(data: AccountsRegisterResponse) {
  mocks.data = data
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(AccountsRegisterCard, { orgId: ORG }))
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.mutate.mockClear()
  mocks.raw.mockClear()
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('AccountsRegisterCard', () => {
  it('shows the open rule with its fix, the account and the domain', async () => {
    await render(DATA)
    const text = document.body.textContent ?? ''
    expect(text).toContain('has one person who can sign in')
    expect(text).toContain('Invite a second Admin.')
    expect(text).toContain('Kenji Ltd')
    expect(text).toContain('glot.it')
  })

  it('owners add an account through POST with the form values', async () => {
    await render({ ...DATA, accounts: [], findings: [] })
    await act(async () => { button('Add an account').click() })
    const name = document.body.querySelector<HTMLInputElement>('input[placeholder="Team or company it is under"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(name, 'Porkbun')
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { button('Add account').click(); await flush() })
    expect(mocks.mutate).toHaveBeenCalledTimes(1)
    const [path, init] = mocks.mutate.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe(`/v1/admin/orgs/${ORG}/accounts`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({ provider: 'apple', displayName: 'Porkbun', adminCount: 1 })
  })

  it('declares a domain auto-renew with PATCH', async () => {
    await render(DATA)
    const select = Array.from(document.body.querySelectorAll<HTMLSelectElement>('select')).find((s) => s.closest('li')?.textContent?.includes('glot.it'))!
    await act(async () => {
      select.value = 'no'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await flush()
    })
    const [path, init] = mocks.mutate.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe(`/v1/admin/orgs/${ORG}/domains/d1`)
    expect(JSON.parse(String(init.body))).toEqual({ autoRenew: false })
  })

  it('members see the register but no edit controls', async () => {
    await render({ ...DATA, canEdit: false })
    expect(() => button('Edit')).toThrow()
    expect(() => button('Add an account')).toThrow()
    expect(document.body.textContent).toContain('Only team owners and admins can change the register.')
  })

  it('downloads the Markdown through an authenticated fetch', async () => {
    const createObjectURL = vi.fn(() => 'blob:x')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await render(DATA)
    await act(async () => { button('Download as Markdown').click(); await flush() })
    expect(mocks.raw).toHaveBeenCalledWith(`/v1/admin/orgs/${ORG}/accounts/export`)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })
})
