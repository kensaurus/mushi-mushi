/**
 * FILE: apps/admin/src/lib/navBadges.test.ts
 * PURPOSE: Lock the nav-meta slice set Quick and Beginner request.
 *
 * `layoutHeroFromStats` used to read the current page's slices. After it
 * was deleted, that page must not add slices unless its badge is actually
 * in the sidebar. `dashboard` stays the default even when `/health` does
 * not list it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { navSlicesForPaths } from './navBadges'
import { SIMPLE_NAV_GROUPS } from './navRegistry'

function paths(mode: 'quick' | 'beginner'): string[] {
  return SIMPLE_NAV_GROUPS.flatMap((group) => group[mode])
}

/** Slices `layoutHeroFromStats` read for pages that are not Quick/Beginner badges. */
const HERO_ONLY_WHEN_OPEN = [
  'anomalies',
  'billing',
  'codeHealth',
  'costs',
  'drift',
  'experiments',
  'intelligence',
  'iterate',
  'lessons',
  'marketplace',
  'promptLab',
  'releases',
  'research',
  'rewards',
  'skills',
  'sso',
]

describe('navSlicesForPaths', () => {
  it('always asks for dashboard, and /health does not repeat it', () => {
    const src = readFileSync(resolve(__dirname, 'navBadges.tsx'), 'utf8')
    expect(src).toContain("'/health': ['health']")
    expect(src).not.toContain("'/health': ['health', 'dashboard']")
    expect(navSlicesForPaths([])).toEqual(['dashboard'])
    expect(navSlicesForPaths(['/inbox', '/reports'])).toEqual(['dashboard'])
    expect(navSlicesForPaths(['/health'])).toEqual(['dashboard', 'health'])
  })

  it('keeps the stats routes that fill badge counters, not slices.*', () => {
    expect(navSlicesForPaths(['/projects'])).toEqual(['dashboard', 'projects'])
    expect(navSlicesForPaths(['/organization/members'])).toEqual(['dashboard', 'members'])
  })

  it('strips the query before looking up a path', () => {
    expect(navSlicesForPaths(['/skills?tab=catalog'])).toEqual(['dashboard', 'skills'])
    expect(navSlicesForPaths(['/team?view=billing'])).toEqual(['dashboard'])
  })

  it('Quick and Beginner sidebars do not request slices only the open page hero used', () => {
    const quick = navSlicesForPaths(paths('quick'))
    const beginner = navSlicesForPaths(paths('beginner'))
    expect(quick).toEqual(['dashboard', 'fixes', 'integrations', 'onboarding', 'projects', 'settings'])
    expect(beginner).toEqual([
      'dashboard',
      'fixes',
      'integrations',
      'mcp',
      'onboarding',
      'projects',
      'qaCoverage',
      'repo',
      'settings',
    ])
    for (const key of HERO_ONLY_WHEN_OPEN) {
      expect(quick).not.toContain(key)
      expect(beginner).not.toContain(key)
    }
  })

  it('Layout does not union the current pathname into the slice request', () => {
    const layout = readFileSync(resolve(__dirname, '../components/Layout.tsx'), 'utf8')
    const block = layout.slice(layout.indexOf('const navSlices'), layout.indexOf('const navCounts'))
    expect(block).toContain('navSlicesForPaths(visibleNav.flatMap')
    expect(block).not.toContain('pathname')
  })
})
