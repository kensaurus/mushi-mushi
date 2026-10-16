import { describe, expect, it } from 'vitest'
import { buildHeroEnrichment } from './layoutHeroFromStats'
import { EMPTY_NAV_STAT_SLICES, type NavStatSlices } from './extendedNavMeta'
import type { NavCounts } from './useNavCounts'

function navCounts(overrides: Partial<NavCounts> & { slices?: Partial<NavStatSlices> } = {}): NavCounts {
  return {
    untriagedBacklog: 0,
    fixesInFlight: 0,
    fixesFailed: 0,
    prsOpen: 0,
    fixesRetryable: 0,
    urgentOpenReports: 0,
    regressedActions: 0,
    inboxOpenActions: 0,
    notificationsUnread: 0,
    queueFailed: 0,
    healthIssues: 0,
    flaggedDevices: 0,
    feedbackWithReply: 0,
    judgeDisagreements: 0,
    projectCount: 0,
    projectsNeedingAttention: 0,
    neverIngestedCount: 0,
    staleKeyCount: 0,
    memberCount: 3,
    pendingInvites: 0,
    membersInactiveCount: 3,
    membersAtSeatCap: false,
    membersExpiringInvites: 0,
    superAdminSignups7d: null,
    superAdminChurn30d: null,
    slices: { ...EMPTY_NAV_STAT_SLICES, ...overrides.slices },
    ready: true,
    ...overrides,
  }
}

describe('buildHeroEnrichment', () => {
  it('returns nothing for a route with no live hero data', () => {
    expect(buildHeroEnrichment('/unknown', navCounts())).toEqual({})
  })

  it('enriches the members hero with live inactive seat metrics', () => {
    const hero = buildHeroEnrichment('/organization/members', navCounts())
    expect(hero.decide?.metric).toContain('3 member')
    expect(hero.decide?.metric).toContain('3 inactive')
    expect(hero.decide?.severity).toBe('warn')
    expect(hero.act?.primary?.kind).toBe('link')
    if (hero.act?.primary?.kind === 'link') {
      expect(hero.act.primary.to).toContain('/organization/members')
    }
    expect(hero.actIdle?.label).toBeTruthy()
  })

  it('surfaces the seat-cap act when at cap', () => {
    const hero = buildHeroEnrichment(
      '/organization/members',
      navCounts({ membersAtSeatCap: true, membersInactiveCount: 0 }),
    )
    expect(hero.decide?.severity).toBe('crit')
    expect(hero.act?.primary?.kind).toBe('link')
    if (hero.act?.primary?.kind === 'link') {
      expect(hero.act.primary.to).toBe('/billing')
    }
  })
})
