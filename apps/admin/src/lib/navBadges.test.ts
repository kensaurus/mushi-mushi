/**
 * FILE: apps/admin/src/lib/navBadges.test.ts
 * PURPOSE: Lock the nav-meta slice set Quick and Beginner request.
 *
 * `layoutHeroFromStats` used to read the current page's slices. After it
 * was deleted, that page must not add slices unless its badge is actually
 * in the sidebar (Layout side: `components/Layout.navSlices.test.tsx`).
 * `dashboard` stays the default even when `/health` does not list it.
 */

import { describe, expect, it } from 'vitest'
import { navSlicesForPaths } from './navBadges'
import { SIMPLE_NAV_GROUPS } from './navRegistry'

function paths(mode: 'quick' | 'beginner'): string[] {
  return SIMPLE_NAV_GROUPS.flatMap((group) => group[mode])
}

describe('navSlicesForPaths', () => {
  it('always asks for dashboard, and /health does not repeat it', () => {
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

  it('Quick and Beginner sidebars request only their own badges', () => {
    expect(navSlicesForPaths(paths('quick'))).toEqual([
      'dashboard',
      'fixes',
      'integrations',
      'onboarding',
      'projects',
      'settings',
    ])
    expect(navSlicesForPaths(paths('beginner'))).toEqual([
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
  })
})
