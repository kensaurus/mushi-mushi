/**
 * FILE: apps/admin/src/lib/navRegistry.test.ts
 * PURPOSE: B16–B18 — the sidebar speaks plain words, the default sidebars are
 *          small and task-shaped, no page name appears twice, and the command
 *          palette finds a page by its current OR former name.
 */

import { describe, expect, it } from 'vitest'
import { NAV_REGISTRY, SIMPLE_NAV_GROUPS } from './navRegistry'
import { rankPaletteRoutes } from './searchIndex'

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
      '/drift': 'drift',
      '/recipe': 'recipe',
      '/anti-gaming': 'anti-gaming',
      '/iterate': 'iterate',
      '/intelligence': 'intelligence',
      '/anomalies': 'anomalies',
      '/prompt-lab': 'prompt lab',
      '/inbox': 'action inbox',
      '/queue': 'failed events',
      '/reports': 'reports',
      '/portfolio': 'portfolio',
      '/overview': 'overview',
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
    expect(top('drift')).toBe('/drift')
    expect(top('iterate')).toBe('/iterate')
    expect(top('action inbox')).toBe('/inbox')
    expect(top('prompt lab')).toBe('/prompt-lab')
  })

  it('ranks an exact label above partial matches', () => {
    expect(top('bugs')).toBe('/reports')
    expect(top('billing')).toBe('/billing')
  })

  it('returns nothing for text that is not a page (reports search takes over)', () => {
    expect(rankPaletteRoutes('checkout crash')).toEqual([])
  })
})
