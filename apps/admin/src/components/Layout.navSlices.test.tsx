/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/Layout.navSlices.test.tsx
 * PURPOSE: Pin which nav-meta slices Layout asks `useNavCounts` for.
 *          The one sidebar (core pages plus enabled Labs) asks only for
 *          the visible badges. The open page adds nothing when it is not
 *          in the sidebar — that union existed for `layoutHeroFromStats`,
 *          which has no caller.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { navSlicesForPaths } from '../lib/navBadges'
import { CORE_NAV_PATHS } from '../lib/navRegistry'

const state = vi.hoisted(() => ({
  enabledLabs: new Set<string>(),
  sliceCalls: [] as Array<readonly string[] | null | undefined>,
}))

vi.mock('../lib/useNavCounts', () => ({
  useNavCounts: (opts: { live?: boolean; slices?: readonly string[] | null } = {}) => {
    if (opts.live) state.sliceCalls.push(opts.slices)
    return { ready: false, slices: {} }
  },
  toneForBacklog: () => 'warn',
}))

vi.mock('../lib/labs', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../lib/labs')
  return {
    ...actual,
    useLabs: () => ({
      enabled: state.enabledLabs,
      isEnabled: (id: string) => state.enabledLabs.has(id),
      setEnabled: () => {},
    }),
  }
})

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'owner@example.com' }, signOut: async () => {} }),
}))
vi.mock('../lib/useEntitlements', () => ({
  useEntitlements: () => ({ isSuperAdmin: false, isOperator: false, has: () => true, loading: false }),
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
vi.mock('./SidebarUserCard', () => ({ SidebarUserCard: () => null, SignOutAllDialog: () => null }))
vi.mock('./PrivacyPostureBadge', () => ({ PrivacyPostureBadge: () => null }))
vi.mock('./VersionBadge', () => ({ VersionBadge: () => null }))
vi.mock('./AskMushiLauncherButton', () => ({ AskMushiLauncherButton: () => null }))
vi.mock('./AskMushiSidebar', () => ({ AskMushiSidebar: () => null }))
vi.mock('./RoutePageHelp', () => ({ RoutePageHelp: () => null }))
vi.mock('./RouteProgress', () => ({ RouteProgress: () => null }))
vi.mock('./SidebarFooterControls', () => ({ SidebarFooterControls: () => null }))

import { Layout } from './Layout'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  state.enabledLabs = new Set()
  state.sliceCalls = []
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

function renderAt(pathname: string): void {
  act(() => {
    root!.render(
      createElement(MemoryRouter, { initialEntries: [pathname] }, createElement(Layout, null, createElement(Null))),
    )
  })
}

function expectSlices(expected: readonly string[]): void {
  expect(state.sliceCalls.length).toBeGreaterThan(0)
  for (const slices of state.sliceCalls) {
    expect(slices).toEqual(expected)
  }
}

describe('Layout nav-meta slices', () => {
  it('asks only for the core sidebar badges, not the open page', () => {
    renderAt('/releases')
    const expected = navSlicesForPaths(CORE_NAV_PATHS)
    expectSlices(expected)
    expect(expected).not.toContain('releases')
    expect(expected).toEqual([
      'dashboard',
      'fixes',
      'integrations',
      'onboarding',
      'settings',
      // Pipeline carries the local worker flags (ADR 0048 amendment 2026-10-28).
      'workers',
    ])
  })

  it('does not add /billing or /health when those pages are not in the sidebar', () => {
    renderAt('/billing')
    expectSlices(navSlicesForPaths(CORE_NAV_PATHS))
    expect(state.sliceCalls.at(-1)).not.toContain('billing')

    state.sliceCalls = []
    renderAt('/health')
    expectSlices(navSlicesForPaths(CORE_NAV_PATHS))
    expect(state.sliceCalls.at(-1)).not.toContain('health')
  })

  it('adds a Lab’s slice only when that Lab is in the sidebar', () => {
    state.enabledLabs = new Set(['releases'])
    renderAt('/billing')
    const expected = navSlicesForPaths([...CORE_NAV_PATHS, '/releases'])
    expectSlices(expected)
    expect(expected).toContain('releases')
    expect(expected).not.toContain('billing')
  })
})
