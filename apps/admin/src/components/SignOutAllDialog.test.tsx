/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/SignOutAllDialog.test.tsx
 * PURPOSE: QA item 225. The collapsed-rail Sign out skipped the confirmation and
 *          left the other stored accounts on the device. Both sidebar entry
 *          points now share this dialog: it asks first, then forgets every
 *          stored account before signing out.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ clearAllAccounts: vi.fn() }))

vi.mock('../lib/accountSessions', () => ({
  useAccounts: () => ({ accounts: [], activeUserId: null }),
  addAccount: vi.fn(),
  switchToAccount: vi.fn(),
  removeAccount: vi.fn(),
  clearAllAccounts: mocks.clearAllAccounts,
}))
vi.mock('../lib/auth', () => ({ useAuth: () => ({}) }))
vi.mock('./PlanBadge', () => ({ PlanBadge: () => null }))

import { SignOutAllDialog } from './SidebarUserCard'

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  mocks.clearAllAccounts.mockReset()
})

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
  if (!found) throw new Error(`no "${label}" button`)
  return found as HTMLButtonElement
}

describe('SignOutAllDialog', () => {
  it('forgets every stored account, then signs out, only after confirming', async () => {
    const order: string[] = []
    mocks.clearAllAccounts.mockImplementation(() => order.push('clear'))
    const signOut = vi.fn(async () => {
      order.push('signOut')
    })
    const onClose = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root!.render(createElement(SignOutAllDialog, { signOut, onClose })))

    expect(signOut).not.toHaveBeenCalled()
    await act(async () => button('Sign out of all').click())

    expect(order).toEqual(['clear', 'signOut'])
    expect(onClose).toHaveBeenCalled()
  })

  it('does nothing when the user stays signed in', () => {
    const signOut = vi.fn()
    const onClose = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root!.render(createElement(SignOutAllDialog, { signOut, onClose })))

    act(() => button('Stay signed in').click())

    expect(signOut).not.toHaveBeenCalled()
    expect(mocks.clearAllAccounts).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
