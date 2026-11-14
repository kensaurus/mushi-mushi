/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/Layout.sidebarTree.test.tsx
 * PURPOSE: The rendered sidebar shows where you are (owner, 2026-10-27:
 *          "some of the pages and subpages are not showing on the sidebar"):
 *          Pipeline is listed, a core page's sub-pages open under it, a page
 *          under More pages opens that list, and the display settings sit in
 *          the account menu, not in the sidebar footer.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  // The full sidebar is the operator's (navRegistry coreNavPathsFor); a builder test sets false.
  isOperator: true,
  collapsed: false,
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
  useEntitlements: () => ({ isSuperAdmin: false, isOperator: state.isOperator, has: () => true, loading: false }),
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
// The real default is the icon rail; most tests read the full sidebar.
vi.mock('../lib/sidebarCollapsed', () => ({ useSidebarCollapsed: () => [state.collapsed, () => {}] }))
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
vi.mock('./SidebarUserCard', async () => {
  const { createElement: h } = await import('react')
  return {
    // The real card opens its menu on click; render the menu content directly.
    SidebarUserCard: ({ menuTop }: { menuTop?: unknown }) => h('div', { 'data-testid': 'account-menu' }, menuTop as never),
    SignOutAllDialog: () => null,
  }
})
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
  state.isOperator = true
  // jsdom has no matchMedia; the theme control in the account menu reads it.
  window.matchMedia ??= ((query: string) =>
    ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList)
  state.collapsed = false
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

function renderAt(entry: string): void {
  act(() => {
    root!.render(createElement(MemoryRouter, { initialEntries: [entry] }, createElement(Layout, null, createElement(Null))))
  })
}

function nav(): HTMLElement {
  // Desktop and mobile both render the sidebar; the first is enough.
  return container!.querySelector('nav[aria-label="Main navigation"]') as HTMLElement
}

function current(): string[] {
  return [...nav().querySelectorAll('a[aria-current="page"]')].map((a) => a.getAttribute('href') ?? '')
}

describe('the sidebar shows where you are', () => {
  it('lists Pipeline and highlights it on /pipeline', () => {
    renderAt('/pipeline')
    expect(nav().querySelector('a[href="/pipeline"]')).not.toBeNull()
    expect(current()).toEqual(['/pipeline'])
  })

  it("opens a core page's sub-pages under it and highlights the one you are on", () => {
    renderAt('/qa-coverage')
    const children = nav().querySelector('[data-testid="nav-children"]')
    expect(children).not.toBeNull()
    expect(children!.querySelector('a[href="/judge"]')).not.toBeNull()
    expect(current()).toEqual(['/qa-coverage'])
  })

  it('keeps Team highlighted on one of its tabs, with no repeat of the tabs in the sidebar', () => {
    renderAt('/team?view=billing')
    expect(current()).toEqual(['/team'])
    expect(nav().querySelector('[data-testid="nav-children"]')).toBeNull()
  })

  it('opens More pages on a page listed there', () => {
    renderAt('/credits')
    const more = nav().querySelector('[data-testid="nav-more-pages"]')
    expect(more).not.toBeNull()
    expect(more!.textContent).toContain('Account')
    expect(current()).toEqual(['/credits'])
  })

  it('scrolls the page you are on into view, even low in More pages', async () => {
    const scrolled: string[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute('href') ?? '')
    }
    try {
      renderAt('/credits')
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
      expect(scrolled).toContain('/credits')
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('keeps More pages closed and sub-pages hidden on a core page with none', () => {
    renderAt('/reports')
    expect(nav().querySelector('[data-testid="nav-more-pages"]')).toBeNull()
    expect(nav().querySelector('[data-testid="nav-children"]')).toBeNull()
  })

  it('puts theme, density, table rows and focus mode in the account menu, not the footer', () => {
    renderAt('/reports')
    const menu = container!.querySelector('[data-testid="account-menu"]')
    expect(menu?.querySelector('[data-testid="display-preferences-menu"]')).not.toBeNull()
    for (const name of ['Theme', 'Density', 'Table rows', 'Focus mode']) expect(menu!.textContent).toContain(name)
    expect(container!.querySelector('[aria-label="UI density"]')).toBeNull()
    expect(container!.querySelector('[aria-label="Portal"]')).toBeNull()
  })
})

describe('the icon rail shows where you are too', () => {
  function rail(): HTMLElement {
    return container!.querySelector('aside nav[aria-label="Main navigation"]') as HTMLElement
  }

  it('shows the sub-page you are on and a More pages button', () => {
    state.collapsed = true
    renderAt('/qa-coverage')
    expect(rail().querySelector('a[href="/qa-coverage"]')).not.toBeNull()
    expect(rail().querySelector('a[href="/judge"]')).toBeNull()
    expect(rail().querySelector('[data-testid="nav-rail-more"]')).not.toBeNull()
  })

  it('shows a More pages page you are on', () => {
    state.collapsed = true
    renderAt('/credits')
    expect(rail().querySelector('a[href="/credits"]')).not.toBeNull()
  })
})

/**
 * Owner, 2026-11-14: "clicking on the icon brings user back to the landing
 * page". The brand (Kenji's face + wordmark) is one link to the landing; the
 * Beta chip stays its own link to /feedback, never nested inside it.
 */
describe('the brand mark links home', () => {
  function brandLinks(): HTMLAnchorElement[] {
    return [...container!.querySelectorAll<HTMLAnchorElement>('aside [data-testid="brand-home-link"]')]
  }

  it('links the full sidebar brand to the landing page, with the Beta chip beside it', () => {
    renderAt('/reports')
    const [link] = brandLinks()
    expect(link).toBeDefined()
    expect(link.getAttribute('href')).toBe('https://kensaur.us/mushi-mushi')
    expect(link.getAttribute('aria-label')).toBe('Mushi Mushi home')
    expect(link.querySelector('img')?.getAttribute('alt')).toBe('')
    expect(link.textContent).toBe('mushimushi')
    expect(link.querySelector('a')).toBeNull()
    const beta = container!.querySelector('aside a[href="/feedback"][aria-label="Beta: send feedback"]')
    expect(beta).not.toBeNull()
    expect(link.contains(beta)).toBe(false)
  })

  it('puts the face link in the phone header, which covers the drawer brand row', () => {
    renderAt('/reports')
    const link = container!.querySelector<HTMLAnchorElement>('header [data-testid="brand-home-link-mobile"]')
    expect(link?.getAttribute('href')).toBe('https://kensaur.us/mushi-mushi')
    expect(link?.getAttribute('aria-label')).toBe('Mushi Mushi home')
    expect(link?.querySelector('img')?.getAttribute('alt')).toBe('')
  })

  it('shows only the face in the icon rail, with the same link', () => {
    state.collapsed = true
    renderAt('/reports')
    const [link] = brandLinks()
    expect(link.getAttribute('href')).toBe('https://kensaur.us/mushi-mushi')
    expect(link.getAttribute('aria-label')).toBe('Mushi Mushi home')
    expect(link.querySelector('img')).not.toBeNull()
    expect(link.textContent).toBe('')
  })
})

/**
 * Console audit 2026-11-11, finding 8: a builder (not a Mushi Mushi operator)
 * saw 21 More pages including SQL query, Processing jobs and Agent skills.
 */
describe('a builder gets the short sidebar', () => {
  it('lists Home, Bugs, Fixes, Pipeline, Connect and Settings as the pages, the rest under More pages', () => {
    state.isOperator = false
    renderAt('/credits')
    for (const p of ['/dashboard', '/reports', '/fixes', '/pipeline', '/connect', '/settings']) {
      expect(nav().querySelector(`a[href="${p}"]`), p).not.toBeNull()
    }
    const more = nav().querySelector('[data-testid="nav-more-pages"]')!
    // Team, Apps and Checks moved under More pages for a builder.
    for (const p of ['/team', '/checks']) {
      const links = [...nav().querySelectorAll(`a[href="${p}"]`)]
      expect(links.length, p).toBeGreaterThan(0)
      expect(links.every((a) => more.contains(a)), p).toBe(true)
    }
    for (const op of ['/queue', '/query', '/skills', '/judge', '/prompt-lab']) {
      expect(nav().querySelector(`a[href="${op}"]`), op).toBeNull()
    }
  })
})
