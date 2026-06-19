import { describe, expect, it } from 'vitest'
import { resolveLayoutHero, type LayoutHeroFallback } from './layoutHeroFromStats'
import { EMPTY_NAV_STAT_SLICES, type NavStatSlices } from './extendedNavMeta'
import type { NavCounts } from './useNavCounts'

const MEMBERS_FALLBACK: LayoutHeroFallback = {
  title: 'Members',
  kicker: 'Workspace',
  scope: 'members',
  decide: {
    label: 'Team roster',
    summary: 'Static fallback copy.',
    severity: 'info',
  },
  verify: {
    label: 'Invite deliverability',
    detail: 'Static verify copy.',
  },
}

function navCounts(overrides: Partial<NavCounts> & { slices?: Partial<NavStatSlices> } = {}): NavCounts {
  return {
    untriagedBacklog: 0,
    fixesInFlight: 0,
    fixesFailed: 0,
    prsOpen: 0,
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

describe('resolveLayoutHero', () => {
  it('returns null when no fallback exists', () => {
    expect(resolveLayoutHero('/unknown', null, navCounts())).toBeNull()
  })

  it('enriches members hero with live inactive seat metrics', () => {
    const hero = resolveLayoutHero('/organization/members', MEMBERS_FALLBACK, navCounts())
    expect(hero?.decide.metric).toContain('3 member')
    expect(hero?.decide.metric).toContain('3 inactive')
    expect(hero?.decide.severity).toBe('warn')
    expect(hero?.act?.primary?.kind).toBe('link')
    if (hero?.act?.primary?.kind === 'link') {
      expect(hero.act.primary.to).toContain('/organization/members')
    }
    expect(hero?.actIdle?.label).toBeTruthy()
  })

  it('surfaces seat-cap act when at cap', () => {
    const hero = resolveLayoutHero(
      '/organization/members',
      MEMBERS_FALLBACK,
      navCounts({ membersAtSeatCap: true, membersInactiveCount: 0 }),
    )
    expect(hero?.decide.severity).toBe('crit')
    expect(hero?.act?.primary?.kind).toBe('link')
    if (hero?.act?.primary?.kind === 'link') {
      expect(hero.act.primary.to).toBe('/billing')
    }
  })

  it('keeps static fallback when nav counts not ready', () => {
    const hero = resolveLayoutHero(
      '/organization/members',
      MEMBERS_FALLBACK,
      navCounts({ ready: false }),
    )
    expect(hero?.decide.summary).toBe('Static fallback copy.')
    expect(hero?.act).toBeNull()
  })
})
