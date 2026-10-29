/**
 * FILE: apps/admin/src/lib/navBadges.test.ts
 * PURPOSE: Lock the nav-meta slice set the sidebar requests.
 *
 * `layoutHeroFromStats` used to read the current page's slices. After it
 * was deleted, that page must not add slices unless its badge is actually
 * in the sidebar (Layout side: `components/Layout.navSlices.test.tsx`).
 * `dashboard` stays the default even when `/health` does not list it.
 */

import { describe, expect, it } from 'vitest'
import { navSlicesForPaths } from './navBadges'
import { CORE_NAV_PATHS } from './navRegistry'

describe('navSlicesForPaths', () => {
  it('always asks for dashboard, /health included', () => {
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

  it('the core sidebar requests only its own badges', () => {
    expect(navSlicesForPaths(CORE_NAV_PATHS)).toEqual([
      'dashboard',
      'fixes',
      'integrations',
      'onboarding',
      'settings',
      // Pipeline carries the local worker flags (ADR 0048 amendment 2026-10-28).
      'workers',
    ])
  })

  it('an enabled Lab adds that page\'s badge and nothing else', () => {
    expect(navSlicesForPaths([...CORE_NAV_PATHS, '/releases'])).toEqual([
      'dashboard',
      'fixes',
      'integrations',
      'onboarding',
      'releases',
      'settings',
      'workers',
    ])
  })
})
