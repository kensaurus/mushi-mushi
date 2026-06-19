/**
 * Seed NavCounts from a page's authoritative /stats response so hero
 * enrichment reuses the same rules as layout nav-meta.
 */

import type { AnomaliesStats } from '../../components/anomalies/AnomaliesStatsTypes'
import type { BillingStats } from '../../components/billing/types'
import type { CodeHealthStats } from '../../components/code-health/CodeHealthStatsTypes'
import type { CostStats } from '../../components/cost/types'
import type { DashboardStats } from '../../components/dashboard/DashboardStatsTypes'
import type { DriftStats } from '../../components/drift/DriftStatsTypes'
import type { ExperimentsStats } from '../../components/experiments/ExperimentsStatsTypes'
import type { ExploreStats } from '../../components/explore/ExploreStatsTypes'
import type { FixesStats } from '../../components/fixes/FixesStatsTypes'
import type { GraphStats } from '../../components/graph/GraphStatsTypes'
import type { HealthStats } from '../../components/health/HealthStatsTypes'
import type { IntelligenceStats } from '../../components/intelligence/IntelligenceStatsTypes'
import type { InventoryStats } from '../../components/inventory/InventoryStatsTypes'
import type { IterateStats } from '../../components/iterate/IterateStatsTypes'
import type { JudgeStats } from '../../components/judge/JudgeStatsTypes'
import type { LessonsStats } from '../../components/lessons/LessonsStatsTypes'
import type { MembersStats } from '../../components/members/types'
import type { McpStats } from '../../components/mcp/types'
import type { MarketplaceStats } from '../../components/marketplace/types'
import type { ProjectsStats } from '../../components/projects/types'
import type { OnboardingStats } from '../../components/onboarding/types'
import type { PromptLabStats } from '../../components/prompt-lab/PromptLabStatsTypes'
import type { QaCoverageStats } from '../../components/qa-coverage/QaCoverageStatsTypes'
import type { ReleasesStats } from '../../components/releases/ReleasesStatsTypes'
import type { RepoStats } from '../../components/repo/RepoStatsTypes'
import type { ResearchStats } from '../../components/research/ResearchStatsTypes'
import type { RewardsStats } from '../../components/rewards/types'
import type { SettingsStats } from '../../components/settings/types'
import type { SkillsStats } from '../../components/skills/SkillsStatsTypes'
import type { SsoStats } from '../../components/sso/types'
import type { StorageStats } from '../../components/storage/types'
import { EMPTY_NAV_STAT_SLICES, type NavStatSlices } from '../extendedNavMeta'
import type { NavCounts } from '../useNavCounts'

export const READY_NAV_COUNTS_SEED: NavCounts = {
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
  memberCount: null,
  pendingInvites: 0,
  membersInactiveCount: 0,
  membersAtSeatCap: false,
  membersExpiringInvites: 0,
  superAdminSignups7d: null,
  superAdminChurn30d: null,
  slices: EMPTY_NAV_STAT_SLICES,
  ready: true,
}

function seed(overrides: Omit<Partial<NavCounts>, 'slices'> & { slices?: Partial<NavStatSlices> }): NavCounts {
  return {
    ...READY_NAV_COUNTS_SEED,
    ...overrides,
    slices: { ...READY_NAV_COUNTS_SEED.slices, ...(overrides.slices ?? {}) },
  }
}

/** Map page /stats payloads → NavCounts shape for buildHeroEnrichment(). */
export function syntheticNavCountsForRoute(route: string, stats: unknown): NavCounts | null {
  if (stats == null || typeof stats !== 'object') return null

  switch (route) {
    case '/organization/members': {
      const s = stats as MembersStats
      return seed({
        memberCount: s.memberCount,
        pendingInvites: s.pendingInvites,
        membersInactiveCount: s.inactiveCount,
        membersAtSeatCap: s.atSeatCap,
        membersExpiringInvites: s.expiringSoonInvites,
      })
    }
    case '/dashboard': {
      const s = stats as DashboardStats
      return seed({
        untriagedBacklog: s.openBacklog,
        fixesInFlight: s.fixesInProgress,
        fixesFailed: s.fixesFailed,
        prsOpen: s.openPrs,
        healthIssues: s.integrationIssues,
        slices: {
          dashboard: {
            openBacklog: s.openBacklog,
            fixesFailed: s.fixesFailed,
            fixesInProgress: s.fixesInProgress,
            integrationIssues: s.integrationIssues,
            topPriority: s.topPriority,
          },
        },
      })
    }
    case '/code-health':
      return seed({ slices: { codeHealth: stats as CodeHealthStats } })
    case '/lessons':
      return seed({ slices: { lessons: stats as LessonsStats } })
    case '/drift':
      return seed({ slices: { drift: stats as DriftStats } })
    case '/experiments':
      return seed({ slices: { experiments: stats as ExperimentsStats } })
    case '/anomalies':
      return seed({ slices: { anomalies: stats as AnomaliesStats } })
    case '/releases':
      return seed({ slices: { releases: stats as ReleasesStats } })
    case '/intelligence':
      return seed({ slices: { intelligence: stats as IntelligenceStats } })
    case '/prompt-lab':
      return seed({ slices: { promptLab: stats as PromptLabStats } })
    case '/research':
      return seed({ slices: { research: stats as ResearchStats } })
    case '/iterate':
      return seed({ slices: { iterate: stats as IterateStats } })
    case '/skills':
      return seed({ slices: { skills: stats as SkillsStats } })
    case '/repo': {
      const s = stats as RepoStats
      return seed({ prsOpen: s.prOpen ?? 0, slices: { repo: s } })
    }
    case '/billing':
      return seed({ slices: { billing: stats as BillingStats } })
    case '/rewards':
      return seed({ slices: { rewards: stats as RewardsStats } })
    case '/cost': {
      const s = stats as CostStats
      return seed({
        slices: {
          costs: {
            spendSpike24h: s.spendSpike24h,
            failedCalls24h: s.failedCalls24h,
            calls24h: s.calls24h,
            spend24hUsd: s.spend24hUsd,
          },
        },
      })
    }
    case '/sso': {
      const s = stats as SsoStats
      return seed({
        slices: {
          sso: {
            failedCount: s.failedCount,
            pendingCount: s.pendingCount,
            manualRequiredCount: s.manualRequiredCount,
            ssoEntitlement: s.ssoEntitlement,
          },
        },
      })
    }
    case '/settings': {
      const s = stats as SettingsStats
      return seed({
        slices: {
          settings: {
            byokKeysFailing: s.byokKeysFailing,
            byokKeysUntested: s.byokKeysUntested,
            byokKeysConfigured: s.byokKeysConfigured,
            slackConfigured: s.slackConfigured,
            githubRepoConfigured: s.githubRepoConfigured,
          },
        },
      })
    }
    case '/notifications': {
      const s = stats as { unread?: number; unread_count?: number }
      return seed({ notificationsUnread: s.unread ?? s.unread_count ?? 0 })
    }
    case '/qa-coverage':
      return seed({ slices: { qaCoverage: stats as QaCoverageStats } })
    case '/health':
      return seed({ slices: { health: stats as HealthStats } })
    case '/graph':
      return seed({ slices: { graph: stats as GraphStats } })
    case '/inventory':
      return seed({ slices: { inventory: stats as InventoryStats } })
    case '/judge': {
      const s = stats as JudgeStats
      return seed({ judgeDisagreements: s.disagreementCount ?? 0 })
    }
    case '/explore':
      return seed({ slices: { explore: stats as ExploreStats } })
    case '/onboarding':
      return seed({ slices: { onboarding: stats as OnboardingStats } })
    case '/fixes': {
      const s = stats as FixesStats
      return seed({
        fixesInFlight: s.inProgress,
        fixesFailed: s.failed,
        slices: { fixes: s },
      })
    }
    case '/mcp':
      return seed({ slices: { mcp: stats as McpStats } })
    case '/marketplace':
      return seed({ slices: { marketplace: stats as MarketplaceStats } })
    case '/projects': {
      const s = stats as ProjectsStats
      return seed({
        projectCount: s.projectCount,
        neverIngestedCount: s.neverIngestedCount,
        staleKeyCount: s.staleKeyCount,
        projectsNeedingAttention: s.neverIngestedCount + s.staleKeyCount,
      })
    }
    case '/storage':
      return seed({ slices: { storage: stats as StorageStats } })
    default:
      return null
  }
}
