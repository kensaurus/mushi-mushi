/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/Layout.phoneHeading.test.tsx
 * PURPOSE: At phone width the sidebar wordmark h1 is display:none, so the
 *          phone header carries a visually hidden one. It must appear only
 *          when the page inside main has no h1 of its own.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/useNavCounts', () => ({
  useNavCounts: () => ({ ready: false, slices: {} }),
  toneForBacklog: () => 'warn',
}))
vi.mock('../lib/labs', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../lib/labs')
  return {
    ...actual,
    useLabs: () => ({ enabled: new Set<string>(), isEnabled: () => false, setEnabled: () => {} }),
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
// Below the 48rem breakpoint: the phone header is the visible one.
vi.mock('../lib/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('./WhatsNew', () => ({
  useWhatsNew: () => ({ open: false, closePanel: () => {}, entries: [] }),
  WhatsNewModal: () => null,
}))
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

const TitledWithH2 = () => createElement('h2', null, 'Fixes')
const TitledWithH1 = () => createElement('h1', null, 'Loop is clean')

function renderAt(pathname: string, page: () => ReturnType<typeof createElement>): void {
  act(() => {
    root!.render(createElement(MemoryRouter, { initialEntries: [pathname] }, createElement(Layout, null, createElement(page))))
  })
}

function phoneHeader(): HTMLElement {
  const header = document.querySelector('[aria-label="Open navigation menu"]')?.closest('header')
  if (!header) throw new Error('no phone header')
  return header
}

describe('Layout phone heading', () => {
  it('gives a page titled with an h2 a hidden "mushi mushi" h1 in the phone header', () => {
    renderAt('/fixes', TitledWithH2)
    const h1 = phoneHeader().querySelector('h1')
    expect(h1?.textContent).toBe('mushi mushi')
    expect(h1?.className).toBe('sr-only')
    expect(document.querySelectorAll('#main-content h1')).toHaveLength(0)
  })

  it('leaves the phone header without an h1 when the page inside main has one', () => {
    renderAt('/', TitledWithH1)
    expect(phoneHeader().querySelector('h1')).toBeNull()
    const pageH1s = document.querySelectorAll('#main-content h1')
    expect(pageH1s).toHaveLength(1)
    expect(pageH1s[0].textContent).toBe('Loop is clean')
  })
})
