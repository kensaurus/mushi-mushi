import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAB_FEATURES } from './labs'
import { CORE_NAV_PATHS, NAV_REGISTRY } from './navRegistry'
import { NAV_CHILDREN, activeParent, isNavPathActive, morePages } from './sidebarTree'

const EVERYONE = { isOperator: true, isSuperAdmin: true }
const USER = { isOperator: false, isSuperAdmin: false }
const NONE: ReadonlySet<string> = new Set()
// Help & support is a sidebar footer link (Layout), so More pages leaves it out.
const FOOTER_NAV_PATHS = ['/feedback']

const registryPaths = new Set(NAV_REGISTRY.map((e) => e.path))
const morePaths = (viewer = EVERYONE, pinned = NONE) =>
  new Set(morePages(viewer, pinned).flatMap((g) => g.entries.map((e) => e.path)))

describe('every page has a place in the sidebar', () => {
  it('lists each sidebar page as core, a sub-page, under More pages or in the footer', () => {
    const more = morePaths()
    const children = new Set(Object.values(NAV_CHILDREN).flat())
    const missing = NAV_REGISTRY.filter((e) => e.inSidebar !== false)
      .map((e) => e.path)
      .filter((p) => !CORE_NAV_PATHS.includes(p) && !children.has(p) && !more.has(p) && !FOOTER_NAV_PATHS.includes(p))
    expect(missing).toEqual([])
  })

  it('keeps Pipeline in the sidebar for every account', () => {
    expect(CORE_NAV_PATHS).toContain('/pipeline')
  })

  it('names only registry pages as sub-pages, under core pages', () => {
    for (const [parent, children] of Object.entries(NAV_CHILDREN)) {
      expect(CORE_NAV_PATHS).toContain(parent)
      for (const child of children) expect(registryPaths.has(child), child).toBe(true)
    }
  })

  it('gives every console route a registry page, or says why it has none', () => {
    const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')
    const routes = [...app.matchAll(/path="(\/[^"*]*)"/g)].map((m) => m[1] as string)
    // Sign-in, public and redirect routes, and detail pages reached from a list.
    const notPages = new Set([
      '/', '/login', '/signup', '/reset-password', '/email/reporter', '/invite/accept', '/integrations',
      '/tester', '/console', '/fine-tuning', '/mcp/manual', '/mcp-auth',
      '/projects/:pid/qa-coverage/:storyId', '/rewards/tester-review', '/org/:slug/settings/',
      // Stripe Checkout's return URLs, redirected to Billing (lib/billingFunnel.ts).
      '/billing/success', '/billing/cancel',
    ])
    const bases = [...registryPaths].map((p) => p.split('?')[0] as string)
    const orphans = routes.filter(
      (r) => !notPages.has(r) && !bases.some((b) => r === b || r.startsWith(`${b}/`)),
    )
    expect(orphans).toEqual([])
  })
})

describe('More pages', () => {
  it('holds the pages that used to be reachable only by search', () => {
    const more = morePaths()
    for (const p of ['/credits', '/feature-board', '/onboarding', '/users']) expect(more.has(p), p).toBe(true)
  })

  it('leaves operator and super-admin pages out for a normal user', () => {
    expect(morePaths(USER).has('/users')).toBe(false)
  })

  it('drops a Lab once it is kept in the sidebar', () => {
    const lab = LAB_FEATURES.find((f) => f.id === 'releases')!
    expect(morePaths().has(lab.paths[0]!)).toBe(true)
    expect(morePaths(EVERYONE, new Set([lab.id])).has(lab.paths[0]!)).toBe(false)
  })
})

describe('which page is open', () => {
  it('matches a view only on that view', () => {
    expect(isNavPathActive('/dashboard', '?view=apps', '/dashboard?view=apps')).toBe(true)
    expect(isNavPathActive('/dashboard', '', '/dashboard?view=apps')).toBe(false)
    expect(isNavPathActive('/reports/abc', '', '/reports')).toBe(true)
    expect(isNavPathActive('/reportsx', '', '/reports')).toBe(false)
  })

  it('finds the core page a sub-page belongs to', () => {
    expect(activeParent('/qa-coverage', '')).toBe('/checks')
    // Home and Team switch views with their own tabs, so the sidebar adds no list.
    expect(activeParent('/team', '?view=billing')).toBeNull()
    expect(NAV_CHILDREN['/dashboard']).toBeUndefined()
    expect(activeParent('/projects', '')).toBe('/portfolio')
    expect(activeParent('/pipeline', '')).toBeNull()
  })
})
