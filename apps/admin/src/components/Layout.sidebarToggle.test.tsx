/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/Layout.sidebarToggle.test.tsx
 * PURPOSE: Owner, 2026-11-20: "collapse and expand button is too near logout".
 *          The collapse / expand toggle now sits at the top of the desktop
 *          sidebar, by the brand, and sign-out stays at the bottom (in the
 *          account menu when expanded, a confirmed rail tile when collapsed).
 *          These tests pin that order and that the toggle (and `[`) still
 *          collapses and expands the sidebar.
 */

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ initialCollapsed: false }))

vi.mock('../lib/useNavCounts', () => ({
  useNavCounts: () => ({ ready: false, slices: {} }),
  toneForBacklog: () => 'warn',
}))
vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'owner@example.com', user_metadata: {}, app_metadata: {} },
    signOut: async () => {},
    signInWithGoogle: async () => ({}),
    signInWithGitHub: async () => ({}),
  }),
}))
vi.mock('../lib/accountSessions', () => ({
  useAccounts: () => ({ accounts: [], activeUserId: 'u1' }),
  addAccount: vi.fn(),
  switchToAccount: vi.fn(),
  removeAccount: vi.fn(),
  clearAllAccounts: vi.fn(),
}))
vi.mock('../lib/useEntitlements', () => ({
  useEntitlements: () => ({ isSuperAdmin: false, isOperator: true, has: () => true, loading: false }),
}))
vi.mock('../lib/useSetupStatus', () => ({
  useSetupStatus: () => ({ loading: false, activeProject: null, selectors: { done: true } }),
}))
vi.mock('../lib/useProjectSnapshots', () => ({
  useProjectSnapshots: () => ({ byId: new Map() }),
}))
vi.mock('./ProjectSwitcher', () => ({
  ProjectSwitcher: () => null,
  useActiveProjectId: () => 'p1',
}))
// A real state hook (not localStorage) so a click re-renders the sidebar.
vi.mock('../lib/sidebarCollapsed', () => ({
  useSidebarCollapsed: () => useState(state.initialCollapsed),
}))
vi.mock('../lib/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('../lib/favicon', () => ({ useFaviconBadge: () => {} }))
vi.mock('../lib/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('./WhatsNew', () => ({
  useWhatsNew: () => ({ open: false, closePanel: () => {}, entries: [] }),
  WhatsNewModal: () => null,
}))

const Null = () => null
vi.mock('./OrgSwitcher', () => ({ OrgSwitcher: () => null }))
vi.mock('./NextStep', () => ({ NextStep: () => null }))
vi.mock('./ChromeBreadcrumb', () => ({ ChromeBreadcrumb: () => null }))
vi.mock('./FirstRunTour', () => ({ FirstRunTour: () => null }))
vi.mock('./setup-guide/SetupGuide', () => ({ SetupGuide: () => null }))
vi.mock('./CommandPalette', () => ({ CommandPalette: () => null }))
vi.mock('./SearchButton', () => ({ SearchButton: () => null }))
vi.mock('./HotkeysModal', () => ({ HotkeysModal: () => null }))
vi.mock('./ActivityDrawer', () => ({ ActivityDrawer: () => null }))
vi.mock('./PlanBadge', () => ({ PlanBadge: () => null }))
vi.mock('./PrivacyPostureBadge', () => ({ PrivacyPostureBadge: () => null }))
vi.mock('./VersionBadge', () => ({ VersionBadge: () => null }))
vi.mock('./AskMushiLauncherButton', () => ({ AskMushiLauncherButton: () => null }))
vi.mock('./AskMushiSidebar', () => ({ AskMushiSidebar: () => null }))
vi.mock('./RoutePageHelp', () => ({ RoutePageHelp: () => null }))
vi.mock('./RouteProgress', () => ({ RouteProgress: () => null }))

import { Layout } from './Layout'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  state.initialCollapsed = false
  window.matchMedia ??= ((query: string) =>
    ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function render(): void {
  act(() => {
    root!.render(createElement(MemoryRouter, { initialEntries: ['/reports'] }, createElement(Layout, null, createElement(Null))))
  })
}

function sidebar(): HTMLElement {
  return container!.querySelector('aside#desktop-sidebar') as HTMLElement
}

function toggle(): HTMLButtonElement {
  const found = sidebar().querySelectorAll<HTMLButtonElement>('[data-testid="sidebar-toggle"]')
  expect(found).toHaveLength(1)
  return found[0]
}

function nav(): HTMLElement {
  return sidebar().querySelector('nav[aria-label="Main navigation"]') as HTMLElement
}

function isBefore(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

/**
 * Every sidebar control that signs out when pressed. Menu triggers (the
 * account card, whose name mentions what its menu holds) are not sign-out.
 */
function signOutControls(): HTMLElement[] {
  return [...sidebar().querySelectorAll<HTMLElement>('button, [role="menuitem"]')].filter(
    (el) => !el.hasAttribute('aria-haspopup') && /sign out/i.test(el.getAttribute('aria-label') ?? el.textContent ?? ''),
  )
}

describe('the sidebar collapse toggle sits at the top, away from sign-out', () => {
  it('puts Collapse in the brand row, above the nav, with no one-tap sign-out on the account card', () => {
    render()
    const btn = toggle()
    expect(btn.getAttribute('aria-label')).toBe('Collapse sidebar')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('aria-controls')).toBe('desktop-sidebar')
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('[')
    // In the brand row, beside the home link, and before the nav.
    const brand = sidebar().querySelector('[data-testid="brand-home-link"]')!
    expect(btn.closest('.chrome-top-row')).toBe(brand.closest('.chrome-top-row'))
    expect(isBefore(btn, nav())).toBe(true)
    // At least a 28px target (WCAG 2.2 asks for 24).
    expect(btn.className).toContain('size-7')
    expect(btn.className).toContain('focus-visible:ring-2')

    // The account card is one button that opens a menu; sign-out is only in it.
    expect(signOutControls()).toEqual([])
    const card = sidebar().querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    expect(isBefore(nav(), card)).toBe(true)
    act(() => card.click())
    const menu = sidebar().querySelector('[role="menu"]')!
    const signOut = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => /sign out/i.test(el.textContent ?? ''))
    expect(signOut).toBeDefined()
    expect(isBefore(btn, signOut!)).toBe(true)
  })

  it('collapses to the rail and expands again from the same top control', () => {
    render()
    expect(sidebar().getAttribute('data-collapsed')).toBe('false')

    act(() => toggle().click())
    expect(sidebar().getAttribute('data-collapsed')).toBe('true')
    const expand = toggle()
    expect(expand.getAttribute('aria-label')).toBe('Expand sidebar')
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    // A 44px rail tile, first under the mark, above the nav.
    expect(expand.className).toContain('nav-rail-item')
    expect(isBefore(expand, nav())).toBe(true)

    act(() => toggle().click())
    expect(sidebar().getAttribute('data-collapsed')).toBe('false')
    expect(toggle().getAttribute('aria-label')).toBe('Collapse sidebar')
  })

  it('keeps the rail sign-out at the bottom, after the nav, with the expand control at the top', () => {
    state.initialCollapsed = true
    render()
    const expand = toggle()
    const signOut = signOutControls()
    expect(signOut).toHaveLength(1)
    expect(isBefore(expand, nav())).toBe(true)
    expect(isBefore(nav(), signOut[0])).toBe(true)
    // Not in the same group: the old layout had both in the footer.
    expect(expand.parentElement!.contains(signOut[0])).toBe(false)
  })

  it('toggles with the [ key', () => {
    render()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))
    })
    expect(sidebar().getAttribute('data-collapsed')).toBe('true')
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))
    })
    expect(sidebar().getAttribute('data-collapsed')).toBe('false')
  })

  it('leaves the collapse toggle out of the phone drawer, which has its own close button', () => {
    render()
    act(() => container!.querySelector<HTMLButtonElement>('button[aria-label="Open navigation menu"]')!.click())
    expect(container!.querySelector('button[aria-label="Close navigation menu"]')).not.toBeNull()
    const toggles = container!.querySelectorAll('[data-testid="sidebar-toggle"]')
    expect(toggles).toHaveLength(1)
    expect(sidebar().contains(toggles[0])).toBe(true)
  })
})
