import { describe, expect, it } from 'vitest'
import {
  anomaliesNavBadge,
  billingNavBadge,
  checkSectionAttention,
  codeHealthNavBadge,
  contentQualityNavBadge,
  iterateNavBadge,
  lessonsNavBadge,
  onboardingNavBadge,
  qaCoverageNavBadge,
  rewardsNavBadge,
  fullstackAuditNavBadge,
  dashboardNavBadge,
  mcpNavBadge,
  costsNavBadge,
  doSectionAttention,
  startSectionAttention,
  planSectionAttention,
  actSectionAttention,
  workspaceSlicesAttention,
  usersNavBadge,
} from './extendedNavMeta'
import { EMPTY_NAV_STAT_SLICES } from './extendedNavMeta'

describe('qaCoverageNavBadge', () => {
  it('prioritizes failing stories over inventory', () => {
    const badge = qaCoverageNavBadge({
      totalStories: 12,
      failingStories: 3,
      pendingRuns: 0,
      topPriority: 'failing',
    })
    expect(badge?.mode).toBe('attention')
    expect(badge?.count).toBe(3)
  })
})

describe('onboardingNavBadge', () => {
  it('shows remaining setup steps', () => {
    const badge = onboardingNavBadge({
      setupDone: false,
      requiredComplete: 2,
      requiredTotal: 4,
      sdkHostMismatch: false,
    })
    expect(badge?.count).toBe(2)
  })
})

describe('rewardsNavBadge', () => {
  it('shows contributor inventory when healthy', () => {
    const badge = rewardsNavBadge({
      openDisputesCount: 0,
      webhooksFailing: 0,
      activeContributors30d: 8,
      topPriority: 'healthy',
    })
    expect(badge?.mode).toBe('inventory')
    expect(badge?.count).toBe(8)
  })
})

describe('billingNavBadge', () => {
  it('surfaces past-due as attention only', () => {
    const badge = billingNavBadge({
      pastDueProjects: 1,
      overQuota: false,
      approachingQuota: false,
      unpaidProjects: 0,
    })
    expect(badge?.mode).toBe('attention')
  })
})

describe('checkSectionAttention', () => {
  it('aggregates QA and drift attention', () => {
    const result = checkSectionAttention({
      ...EMPTY_NAV_STAT_SLICES,
      qaCoverage: {
        totalStories: 5,
        failingStories: 2,
        pendingRuns: 0,
        topPriority: 'failing',
      },
      drift: {
        openFindings: 1,
        criticalOpen: 0,
        topPriority: 'warn_findings',
      },
    })
    expect(result?.count).toBe(3)
  })
})

describe('lessonsNavBadge', () => {
  it('shows ready-to-promote as attention', () => {
    expect(
      lessonsNavBadge({
        activeLessons: 4,
        readyToPromote: 2,
        criticalLessons: 0,
        topPriority: 'candidates_ready',
      })?.count,
    ).toBe(2)
  })
})

describe('iterateNavBadge', () => {
  it('shows in-flight runs with ok tone', () => {
    const badge = iterateNavBadge({
      total: 5,
      failed: 0,
      queued: 1,
      running: 1,
      topPriority: 'active_runs',
    })
    expect(badge?.mode).toBe('attention')
    expect(badge?.count).toBe(2)
    expect(badge?.tone).toBe('ok')
  })
})

describe('anomaliesNavBadge', () => {
  it('prioritizes release regressions', () => {
    const badge = anomaliesNavBadge({
      openAnomalies: 4,
      releaseRegressionOpen: 1,
      topPriority: 'open_critical',
    })
    expect(badge?.count).toBe(1)
    expect(badge?.tone).toBe('danger')
  })
})

describe('contentQualityNavBadge', () => {
  it('prioritizes failed regen over open inventory', () => {
    const badge = contentQualityNavBadge({
      openCount: 5,
      inReviewCount: 1,
      regeneratingCount: 0,
      userFlagOpenCount: 0,
      failedRegenCount: 2,
      needsAttentionCount: 6,
      topPriority: 'regen_failed',
    })
    expect(badge?.mode).toBe('attention')
    expect(badge?.count).toBe(2)
    expect(badge?.tone).toBe('danger')
  })
})

describe('codeHealthNavBadge', () => {
  it('surfaces errors before warnings', () => {
    const badge = codeHealthNavBadge({
      errorCount: 3,
      warnCount: 2,
      godFileCount: 5,
      hasRun: true,
      topPriority: 'errors',
    })
    expect(badge?.count).toBe(3)
    expect(badge?.tone).toBe('danger')
  })
})

describe('checkSectionAttention, content checks', () => {
  it('rolls up content QA attention under 4 · Verify, where Content checks lives', () => {
    const result = checkSectionAttention({
      ...EMPTY_NAV_STAT_SLICES,
      contentQuality: {
        openCount: 4,
        inReviewCount: 0,
        regeneratingCount: 0,
        userFlagOpenCount: 0,
        failedRegenCount: 0,
        needsAttentionCount: 4,
        topPriority: 'open_issues',
      },
    })
    expect(result?.count).toBe(4)
    expect(result?.tone).toBe('warn')
  })
})

describe('fullstackAuditNavBadge', () => {
  it('surfaces failed gates as danger', () => {
    const badge = fullstackAuditNavBadge({
      errorCount: 0,
      warnCount: 1,
      failedGateCount: 2,
      topPriority: 'failures',
    })
    expect(badge?.tone).toBe('danger')
    expect(badge?.count).toBe(2)
  })

  it('flags a failed read instead of showing no badge', () => {
    const badge = fullstackAuditNavBadge({ errorCount: 0, warnCount: 0, failedGateCount: 0, topPriority: 'unknown' })
    expect(badge).toMatchObject({ tone: 'warn', label: expect.stringMatching(/could not read/) })
  })
})

describe('dashboardNavBadge', () => {
  it('surfaces integration issues', () => {
    const badge = dashboardNavBadge({
      openBacklog: 0,
      fixesFailed: 0,
      fixesInProgress: 0,
      integrationIssues: 3,
      topPriority: 'integrations',
    })
    expect(badge?.count).toBe(3)
  })
})

describe('mcpNavBadge', () => {
  it('flags endpoint mismatch as danger', () => {
    const badge = mcpNavBadge({
      mcpReadKeyCount: 1,
      neverConnectedCount: 0,
      endpointMismatch: true,
      reportOnlyKeyCount: 0,
      topPriority: 'endpoint_mismatch',
    })
    expect(badge?.tone).toBe('danger')
  })
})

describe('costsNavBadge', () => {
  it('shows spend spike as attention', () => {
    const badge = costsNavBadge({
      spendSpike24h: true,
      failedCalls24h: 0,
      calls24h: 12,
      spend24hUsd: 1.5,
    })
    expect(badge?.mode).toBe('attention')
    expect(badge?.tone).toBe('warn')
  })
})

describe('doSectionAttention', () => {
  it('aggregates repo CI failures', () => {
    const result = doSectionAttention({
      ...EMPTY_NAV_STAT_SLICES,
      repo: { prOpen: 0, ciFailed: 2, topPriority: 'ci_failing' },
    })
    expect(result?.count).toBe(2)
    expect(result?.tone).toBe('danger')
  })
})

describe('usersNavBadge', () => {
  it('shows 7d signups as inventory for operators', () => {
    const badge = usersNavBadge({ signups7d: 5, churn30d: 0 })
    expect(badge?.mode).toBe('inventory')
    expect(badge?.count).toBe(5)
  })
})

// ADR 0027: a section badge counts the pages that sit in that section, so a
// moved page takes its count with it and nothing is counted twice.
describe('section rollups follow the cycle', () => {
  const mcp = {
    mcpReadKeyCount: 1,
    neverConnectedCount: 0,
    endpointMismatch: true,
    reportOnlyKeyCount: 0,
    topPriority: 'endpoint_mismatch',
  }

  it('counts editor agents (MCP) under 1 · Connect, not 5 · Ship & watch', () => {
    const slices = { ...EMPTY_NAV_STAT_SLICES, mcp }
    expect(startSectionAttention(slices)).toMatchObject({ tone: 'danger', label: expect.stringMatching(/MCP/) })
    expect(actSectionAttention(slices)).toBeNull()
  })

  it('counts Home under 2 · Bugs and no longer under 1 · Connect', () => {
    const slices = {
      ...EMPTY_NAV_STAT_SLICES,
      dashboard: { openBacklog: 0, fixesFailed: 0, fixesInProgress: 0, integrationIssues: 3, topPriority: 'integrations' as const },
    }
    expect(planSectionAttention(slices)?.count).toBe(3)
    expect(startSectionAttention(slices)).toBeNull()
  })

  it('counts plugins under Account', () => {
    const slices = {
      ...EMPTY_NAV_STAT_SLICES,
      marketplace: { failingPlugins: 2, neverDeliveredPlugins: 0, installedActive: 3, deliveriesFailed: 0, topPriority: 'failing' },
    }
    expect(workspaceSlicesAttention(slices)).toMatchObject({ count: 2, tone: 'danger' })
    expect(actSectionAttention(slices)).toBeNull()
  })
})
