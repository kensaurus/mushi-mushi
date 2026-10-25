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
import { navBadgeDataRead, navSlicesForPaths } from './navBadges'
import { CORE_NAV_PATHS } from './navRegistry'
import { EMPTY_NAV_STAT_SLICES } from './extendedNavMeta'
import type { NavCounts } from './useNavCounts'

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
    ])
  })
})

function navCounts(over: Partial<NavCounts> = {}): NavCounts {
  return {
    untriagedBacklog: 0, fixesInFlight: 0, fixesFailed: 0, fixesRetryable: 0, prsOpen: 0,
    urgentOpenReports: 0, regressedActions: 0, inboxOpenActions: 0, notificationsUnread: 0,
    queueFailed: 0, healthIssues: 0, flaggedDevices: 0, feedbackWithReply: 0, judgeDisagreements: 0,
    projectCount: 0, projectsNeedingAttention: 0, neverIngestedCount: 0, staleKeyCount: 0,
    memberCount: null, pendingInvites: 0, membersInactiveCount: 0, membersAtSeatCap: false,
    membersExpiringInvites: 0, superAdminSignups7d: null, superAdminChurn30d: null,
    slices: EMPTY_NAV_STAT_SLICES, ready: true, ...over,
  }
}

describe('navBadgeDataRead', () => {
  it('is false until the counters load, whatever the path', () => {
    expect(navBadgeDataRead('/judge', navCounts({ ready: false }))).toBe(false)
  })

  it('is true for a counter-backed path, false for a path nothing is read for', () => {
    expect(navBadgeDataRead('/judge', navCounts())).toBe(true)
    expect(navBadgeDataRead('/ci', navCounts())).toBe(false)
  })

  it('follows whether the path\'s slice actually arrived', () => {
    expect(navBadgeDataRead('/drift', navCounts())).toBe(false)
    const slices = {
      ...EMPTY_NAV_STAT_SLICES,
      drift: { openFindings: 0, criticalOpen: 0, topPriority: 'healthy' as const },
    }
    expect(navBadgeDataRead('/drift?range=7d', navCounts({ slices }))).toBe(true)
  })
})
