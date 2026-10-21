/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/Layout.navSlices.test.tsx
 * PURPOSE: Pin which nav-meta slices Layout asks `useNavCounts` for.
 *          Quick and Beginner ask only for the visible sidebar's badges; the
 *          open page adds nothing when it is not in the sidebar. Advanced
 *          asks for every slice (null).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminMode } from '../lib/mode'
import { navSlicesForPaths } from '../lib/navBadges'
import { SIMPLE_NAV_GROUPS } from '../lib/navRegistry'

const state = vi.hoisted(() => ({
  mode: 'quickstart' as AdminMode,
  sliceCalls: [] as Array<readonly string[] | null | undefined>,
}))

vi.mock('../lib/useNavCounts', () => ({
  useNavCounts: (opts: { live?: boolean; slices?: readonly string[] | null } = {}) => {
    if (opts.live) state.sliceCalls.push(opts.slices)
    return { ready: false, slices: {} }
  },
  toneForBacklog: () => 'warn',
}))

vi.mock('../lib/mode', () => ({
  useAdminMode: () => ({
    mode: state.mode,
    setMode: () => {},
    cycleMode: () => {},
    isQuickstart: state.mode === 'quickstart',
    isBeginner: state.mode === 'beginner',
    isAdvanced: state.mode === 'advanced',
  }),
}))

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

function renderAt(pathname: string, mode: AdminMode): readonly string[] | null | undefined {
  state.mode = mode
  act(() => {
    root!.render(
      createElement(MemoryRouter, { initialEntries: [pathname] }, createElement(Layout, null, createElement(Null))),
    )
  })
  return state.sliceCalls.at(-1)
}

function sidebarPaths(mode: 'quick' | 'beginner'): string[] {
  return SIMPLE_NAV_GROUPS.flatMap((group) => group[mode])
}

describe('Layout nav-meta slices', () => {
  it('Quick asks only for the sidebar badges, not the open page', () => {
    const slices = renderAt('/releases', 'quickstart')
    expect(slices).toEqual(navSlicesForPaths(sidebarPaths('quick')))
    expect(slices).not.toContain('releases')
  })

  it('Beginner asks only for the sidebar badges, not the open page', () => {
    const slices = renderAt('/billing', 'beginner')
    expect(slices).toEqual(navSlicesForPaths(sidebarPaths('beginner')))
    expect(slices).not.toContain('billing')
  })

  it('Advanced asks for every slice', () => {
    expect(renderAt('/releases', 'advanced')).toBeNull()
  })
})
