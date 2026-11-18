/**
 * FILE: apps/admin/src/lib/navBadges.test.ts
 * PURPOSE: Lock the nav-meta slice set the sidebar requests.
 *
 * `layoutHeroFromStats` used to read the current page's slices. After it
 * was deleted, that page must not add slices unless its badge is actually
 * in the sidebar (Layout side: `components/Layout.navSlices.test.tsx`).
 * `dashboard` stays the default even when `/health` does not list it.
 */

import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { navSlicesForPaths, renderNavBadge } from './navBadges'
import { keepMissingSlices, type NavCounts } from './useNavCounts'
import { EMPTY_NAV_STAT_SLICES } from './extendedNavMeta'
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

describe('Settings badge stays put (owner walkthrough, 2026-11-17)', () => {
  // "1 key failing" appeared, vanished on the next load and came back.
  const base = { ready: true, slices: EMPTY_NAV_STAT_SLICES } as unknown as NavCounts
  const failing = { byokKeysFailing: 1, byokKeysUntested: 0, byokKeysExpiring: 0 } as unknown as NavCounts['slices']['settings']

  it('holds the badge place with a skeleton before the first load', () => {
    const el = renderNavBadge('/settings', { ...base, ready: false }, { criticalReports30d: 0 }) as ReactElement<{ 'data-testid'?: string }>
    expect(el?.props['data-testid']).toBe('nav-badge-skeleton')
    // A path with no slice-backed badge shows nothing while loading.
    expect(renderNavBadge('/inbox', { ...base, ready: false }, { criticalReports30d: 0 })).toBeNull()
  })

  it('a load for the same app that lacks the settings slice keeps its last value', () => {
    const prev = { ...base, slices: { ...EMPTY_NAV_STAT_SLICES, settings: failing } } as NavCounts
    const next = { ...base, slices: { ...EMPTY_NAV_STAT_SLICES, settings: null } } as NavCounts
    expect(keepMissingSlices(prev, next, true).slices.settings).toBe(failing)
    // Another app or team never inherits it.
    expect(keepMissingSlices(prev, next, false).slices.settings).toBeNull()
  })
})
