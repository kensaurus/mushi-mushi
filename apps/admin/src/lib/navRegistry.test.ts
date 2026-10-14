/**
 * FILE: apps/admin/src/lib/navRegistry.test.ts
 * PURPOSE: B16–B18 — the sidebar speaks plain words, the default sidebars are
 *          small and task-shaped, no page name appears twice, and the command
 *          palette finds a page by its current OR former name.
 */

import { describe, expect, it } from 'vitest'
import { NAV_REGISTRY, SIMPLE_NAV_GROUPS, routeSection } from './navRegistry'
import { buildOperatorNav } from './buildNav'
import { HOME_HUB } from './pageHubs'
import { paletteRoutesFor, rankPaletteRoutes } from './searchIndex'

const sidebar = NAV_REGISTRY.filter((e) => e.inSidebar !== false)

describe('navigation names', () => {
  it('uses no internal jargon as a sidebar label', () => {
    const jargon = ['Judge', 'Drift', 'Recipe', 'Anti-Gaming', 'Iterate', 'Intelligence', 'Anomalies', 'Prompt Lab']
    for (const e of sidebar) expect(jargon).not.toContain(e.label)
  })

  it('never shows the same name for two pages (sidebar or palette)', () => {
    const labels = NAV_REGISTRY.map((e) => e.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('keeps every former name findable as a search alias', () => {
    const formerNames: Record<string, string> = {
      '/judge': 'judge',
      // Plan 021: these pages are hub views now; their palette entries keep the former names.
      '/health?view=schema': 'drift',
      '/recipe': 'recipe',
      '/anti-gaming': 'anti-gaming',
      '/iterate': 'iterate',
      '/dashboard?view=insights': 'intelligence',
      '/health?view=spikes': 'anomalies',
      '/prompt-lab': 'prompt lab',
      '/inbox': 'action inbox',
      '/queue': 'failed events',
      '/reports': 'reports',
      '/portfolio': 'portfolio',
      '/dashboard?view=apps': 'overview',
    }
    for (const [path, alias] of Object.entries(formerNames)) {
      const entry = NAV_REGISTRY.find((e) => e.path === path)
      expect(entry?.paletteKeywords, path).toContain(alias)
    }
  })
})

describe('Quick and Beginner sidebars', () => {
  const registryPaths = new Set(NAV_REGISTRY.map((e) => e.path))
  const quick = SIMPLE_NAV_GROUPS.flatMap((g) => g.quick)
  const beginner = SIMPLE_NAV_GROUPS.flatMap((g) => g.beginner)

  it('only lists real pages, each once', () => {
    for (const path of beginner) expect(registryPaths.has(path), path).toBe(true)
    expect(new Set(beginner).size).toBe(beginner.length)
  })

  it('stays small: Quick is a subset of Beginner and far below Advanced', () => {
    for (const path of quick) expect(beginner).toContain(path)
    expect(quick.length).toBeLessThanOrEqual(12)
    expect(beginner.length).toBeLessThanOrEqual(20)
    expect(sidebar.length).toBeGreaterThan(beginner.length * 2)
  })

  it('covers bugs, fixes, apps, connect, integrations and settings', () => {
    for (const path of ['/reports', '/inbox', '/fixes', '/portfolio', '/projects', '/connect', '/integrations/config', '/settings']) {
      expect(quick).toContain(path)
    }
  })
})

describe('palette ranking', () => {
  const top = (q: string) => rankPaletteRoutes(q)[0]?.route.path

  it('finds Settings for "api key" (it used to return Voice/Repo/Portfolio/Recipe)', () => {
    expect(top('api key')).toBe('/settings')
    expect(top('anthropic')).toBe('/settings')
  })

  it('finds a page by its former name', () => {
    expect(top('judge')).toBe('/judge')
    expect(top('drift')).toBe('/health?view=schema')
    expect(top('iterate')).toBe('/iterate')
    expect(top('action inbox')).toBe('/inbox')
    expect(top('prompt lab')).toBe('/prompt-lab')
  })

  it('ranks an exact label above partial matches', () => {
    expect(top('bugs')).toBe('/reports')
    expect(top('billing')).toBe('/team?view=billing')
  })

  it('returns nothing for text that is not a page (reports search takes over)', () => {
    expect(rankPaletteRoutes('checkout crash')).toEqual([])
  })
})

describe('Advanced sidebar Check section (QA #63)', () => {
  // Advanced mode renders the Check section by sub-group only, so an entry
  // without one (Activity and Users & funnels once) silently vanished.
  it('gives every Check sidebar entry a sub-group', () => {
    for (const e of sidebar.filter((x) => x.sectionId === 'check')) {
      expect(e.checkSubGroup, e.path).toBeDefined()
    }
  })
})

describe('palette role gating (QA #72)', () => {
  const paths = (viewer: { isSuperAdmin: boolean; isOperator: boolean }) =>
    paletteRoutesFor(viewer).map((r) => r.path)

  it('leaves operator and super-admin pages out for a normal user', () => {
    const visible = paths({ isSuperAdmin: false, isOperator: false })
    expect(visible).not.toContain('/dashboard?view=growth')
    expect(visible).not.toContain('/users')
    expect(visible).toContain('/settings')
  })

  it('keeps each page for the role that can open it', () => {
    expect(paths({ isSuperAdmin: false, isOperator: true })).toContain('/dashboard?view=growth')
    expect(paths({ isSuperAdmin: true, isOperator: false })).toContain('/users')
  })
})

describe('the vibe-coding cycle (ADR 0027)', () => {
  const sections = buildOperatorNav()

  it('orders the Advanced sections along the cycle', () => {
    expect(sections.map((s) => s.title)).toEqual([
      '1 · Connect',
      '2 · Bugs',
      '3 · Fix',
      '4 · Verify',
      '5 · Ship & watch',
      'Account',
    ])
    expect(sections.map((s) => s.step ?? null)).toEqual([1, 2, 3, 4, 5, null])
  })

  it('puts each step’s first page where the cycle starts it', () => {
    const first = (title: string) => sections.find((s) => s.title === title)?.items[0]?.path
    expect(first('1 · Connect')).toBe('/onboarding')
    expect(first('2 · Bugs')).toBe('/dashboard')
    expect(first('3 · Fix')).toBe('/fixes')
    expect(first('4 · Verify')).toBe('/qa-coverage')
    expect(first('5 · Ship & watch')).toBe('/portfolio')
  })

  it('orders the Quick and Beginner groups the same way', () => {
    expect(SIMPLE_NAV_GROUPS.map((g) => g.title)).toEqual(['Connect', 'Bugs', 'Fix', 'Verify', 'Ship & watch', 'Account'])
  })

  it('gives a moved page the palette heading of the section it sits in', () => {
    const group = { start: 'Start', plan: 'Plan', do: 'Do', check: 'Check', act: 'Act', workspace: 'Workspace' } as const
    for (const e of NAV_REGISTRY) expect(e.paletteGroup, e.path).toBe(group[e.sectionId])
  })

  it('uses "All apps" for one page only (Home’s view is Overview)', () => {
    expect(NAV_REGISTRY.filter((e) => e.label === 'All apps').map((e) => e.path)).toEqual(['/portfolio'])
    expect(HOME_HUB.views.map((v) => v.label)).not.toContain('All apps')
  })
})

describe('routeSection (breadcrumb)', () => {
  it('names the section a page sits in and links to its first page', () => {
    expect(routeSection('/graph')).toEqual({ title: '2 · Bugs', firstPath: '/dashboard' })
    expect(routeSection('/reports/abc')).toEqual({ title: '2 · Bugs', firstPath: '/dashboard' })
    expect(routeSection('/integrations/config')).toEqual({ title: '1 · Connect', firstPath: '/onboarding' })
    expect(routeSection('/judge')?.title).toBe('4 · Verify')
  })
  it('returns null outside the sidebar', () => {
    expect(routeSection('/login')).toBeNull()
  })
})
