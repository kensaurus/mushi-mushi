/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/SidebarUserCard.test.tsx
 * PURPOSE: Owner, 2026-11-20: the red sign-out icon on the account card sat one
 *          tap from the sidebar's Collapse row. The card is now one button that
 *          opens the account menu; sign-out is a menu item there, and it still
 *          asks before signing out.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { User } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/accountSessions', () => ({
  useAccounts: () => ({ accounts: [], activeUserId: 'u1' }),
  addAccount: vi.fn(),
  switchToAccount: vi.fn(),
  removeAccount: vi.fn(),
  clearAllAccounts: vi.fn(),
}))
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ signInWithGoogle: async () => ({}), signInWithGitHub: async () => ({}) }),
}))
vi.mock('./PlanBadge', () => ({ PlanBadge: () => null }))

import { SidebarUserCard } from './SidebarUserCard'

const user = { id: 'u1', email: 'owner@example.com', user_metadata: {}, app_metadata: {} } as unknown as User

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.innerHTML = ''
  root = null
  container = null
})

function buttonsNamed(pattern: RegExp): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('button')].filter((b) =>
    pattern.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
  )
}

describe('SidebarUserCard', () => {
  it('has no one-tap sign-out on the card; sign-out is in the menu and asks first', () => {
    const signOut = vi.fn()
    act(() => root!.render(createElement(SidebarUserCard, { user, signOut })))

    // Closed: the only control is the card itself.
    expect(container!.querySelectorAll('button')).toHaveLength(1)
    const card = container!.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    expect(card.getAttribute('aria-expanded')).toBe('false')
    expect(card.getAttribute('aria-label')).toContain('owner@example.com')
    expect(card.getAttribute('aria-label')).toMatch(/sign out/i)
    expect(container!.querySelector('[aria-label="Sign out"]')).toBeNull()

    act(() => card.click())
    expect(card.getAttribute('aria-expanded')).toBe('true')
    const item = [...container!.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find(
      (el) => el.textContent?.includes('Sign out of all accounts'),
    )
    expect(item).toBeDefined()

    act(() => item!.click())
    expect(signOut).not.toHaveBeenCalled()
    expect(buttonsNamed(/^Sign out of all$/)).toHaveLength(1)
    expect(buttonsNamed(/^Stay signed in$/)).toHaveLength(1)
  })
})
