/**
 * FILE: apps/admin/src/lib/checkStatus.test.ts
 * PURPOSE: `resolveCheckStatus` is what makes a /checks card say something
 *          live. The invariants under test:
 *   - a failing check reuses the sidebar's own sentence and tone;
 *   - a check that is configured and clear says so (the sidebar hides that
 *     badge at zero, the launcher still needs the all-clear);
 *   - a configured-but-empty check asks to be set up;
 *   - a check with no readable data, and any check while the counts load,
 *     says nothing rather than inventing a status.
 */

import { describe, expect, it } from 'vitest'
import { resolveCheckStatus } from './checkStatus'
import { EMPTY_NAV_STAT_SLICES, type NavStatSlices } from './extendedNavMeta'
import type { NavCounts } from './useNavCounts'

const EXTRAS = { criticalReports30d: 0 }

function counts(over: Partial<NavCounts> = {}): NavCounts {
  return {
    untriagedBacklog: 0, fixesInFlight: 0, fixesFailed: 0, fixesRetryable: 0, prsOpen: 0,
    urgentOpenReports: 0, regressedActions: 0, inboxOpenActions: 0, notificationsUnread: 0,
    queueFailed: 0, healthIssues: 0, flaggedDevices: 0, feedbackWithReply: 0, judgeDisagreements: 0,
    projectCount: 1, projectsNeedingAttention: 0, neverIngestedCount: 0, staleKeyCount: 0,
    memberCount: null, pendingInvites: 0, membersInactiveCount: 0, membersAtSeatCap: false,
    membersExpiringInvites: 0, superAdminSignups7d: null, superAdminChurn30d: null,
    slices: EMPTY_NAV_STAT_SLICES, ready: true, ...over,
  }
}

function withSlices(over: Partial<NavStatSlices>): NavCounts {
  return counts({ slices: { ...EMPTY_NAV_STAT_SLICES, ...over } })
}

describe('resolveCheckStatus', () => {
  it('reuses the sidebar sentence and tone for a failing check', () => {
    const status = resolveCheckStatus('/judge', counts({ judgeDisagreements: 4 }), EXTRAS)
    expect(status).toEqual({
      tone: 'danger',
      text: '4 classifier vs judge disagreements',
    })
  })

  it('says all clear for a counts-backed check the sidebar hides at zero', () => {
    expect(resolveCheckStatus('/judge', counts(), EXTRAS)).toEqual({
      tone: 'ok',
      text: 'Judge agrees with classifier',
    })
  })

  it('summarises a configured, clear slice with the sidebar inventory line', () => {
    const status = resolveCheckStatus(
      '/qa-coverage',
      withSlices({
        qaCoverage: { totalStories: 7, failingStories: 0, pendingRuns: 0, topPriority: 'healthy' },
      }),
      EXTRAS,
    )
    expect(status).toEqual({ tone: 'idle', text: '7 QA stories' })
  })

  it('falls back to an all-clear line when the slice badge stays silent', () => {
    const status = resolveCheckStatus(
      '/qa-coverage',
      withSlices({
        qaCoverage: { totalStories: 7, failingStories: 0, pendingRuns: 0, topPriority: 'no_runs' },
      }),
      EXTRAS,
    )
    expect(status).toEqual({ tone: 'ok', text: '7 stories, none failing' })
  })

  it('still reports a failing slice through the nav badge', () => {
    const status = resolveCheckStatus(
      '/qa-coverage',
      withSlices({
        qaCoverage: { totalStories: 7, failingStories: 2, pendingRuns: 0, topPriority: 'failing' },
      }),
      EXTRAS,
    )
    expect(status?.tone).toBe('danger')
    expect(status?.text).toContain('2 QA stories')
  })

  it('asks for set-up when the slice proves the check is empty', () => {
    const status = resolveCheckStatus(
      '/prompt-lab',
      withSlices({
        promptLab: {
          untestedAbCount: 0, promoteReadyCount: 0, abTestingCount: 0, totalPrompts: 0,
          topPriority: 'no_dataset',
        },
      }),
      EXTRAS,
    )
    expect(status).toEqual({ tone: 'idle', text: 'No prompts yet', needsSetup: true })
  })

  it('stays silent for a check with no readable status, and while counts load', () => {
    expect(resolveCheckStatus('/recipe', counts(), EXTRAS)).toBeNull()
    expect(resolveCheckStatus('/qa-coverage', counts(), EXTRAS)).toBeNull()
    expect(resolveCheckStatus('/judge', counts({ ready: false }), EXTRAS)).toBeNull()
  })
})
