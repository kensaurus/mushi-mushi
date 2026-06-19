/**
 * Fallback parallel slice fetches when /v1/admin/workspace/nav-meta is unavailable.
 */

import { apiFetch } from './supabase'
import type { NavStatSlices } from './extendedNavMeta'
import { EMPTY_NAV_STAT_SLICES } from './extendedNavMeta'
import { normalizeNavSlices } from './workspaceNavMetaResponse'
import type { QaCoverageStats } from '../components/qa-coverage/QaCoverageStatsTypes'
import type { LessonsStats } from '../components/lessons/LessonsStatsTypes'
import type { DriftStats } from '../components/drift/DriftStatsTypes'
import type { AnomaliesStats } from '../components/anomalies/AnomaliesStatsTypes'
import type { IterateStats } from '../components/iterate/IterateStatsTypes'
import type { OnboardingStats } from '../components/onboarding/types'
import type { RewardsStats } from '../components/rewards/types'
import type { BillingStats } from '../components/billing/types'
import type { CodeHealthStats } from '../components/code-health/CodeHealthStatsTypes'
import type { ContentQualityStats } from '../components/content-quality/ContentQualityStatsTypes'
import type { ExperimentsStats } from '../components/experiments/ExperimentsStatsTypes'
import type { IntelligenceStats } from '../components/intelligence/IntelligenceStatsTypes'
import type { ReleasesStats } from '../components/releases/ReleasesStatsTypes'
import type { FullstackAuditStats } from '../components/fullstack-audit/FullstackAuditStatsTypes'
import type { DashboardStats } from '../components/dashboard/DashboardStatsTypes'
import type { ExploreStats } from '../components/explore/ExploreStatsTypes'
import type { FixesStats } from '../components/fixes/FixesStatsTypes'
import type { GraphStats } from '../components/graph/GraphStatsTypes'
import type { HealthStats } from '../components/health/HealthStatsTypes'
import type { InventoryStats } from '../components/inventory/InventoryStatsTypes'
import type { PromptLabStats } from '../components/prompt-lab/PromptLabStatsTypes'
import type { RepoStats } from '../components/repo/RepoStatsTypes'
import type { ResearchStats } from '../components/research/ResearchStatsTypes'
import type {
  ComplianceNavSlice,
  CostsNavSlice,
  FeatureBoardNavSlice,
  IntegrationsNavSlice,
  MarketplaceNavSlice,
  McpNavSlice,
  QueryNavSlice,
  SettingsNavSlice,
  SkillsNavSlice,
  SsoNavSlice,
  StorageNavSlice,
} from './remainingNavSliceTypes'

interface AuditStatsResp {
  warnCount24h?: number
  failCount24h?: number
  events24h?: number
}

export async function fetchNavSlicesFallback(projectId: string | null): Promise<NavStatSlices> {
  const [
    lessonsStatsRes,
    driftStatsRes,
    anomaliesStatsRes,
    iterateStatsRes,
    onboardingStatsRes,
    rewardsStatsRes,
    billingStatsRes,
    auditStatsRes,
    qaCoverageStatsRes,
    codeHealthStatsRes,
    contentQualityStatsRes,
    experimentsStatsRes,
    intelligenceStatsRes,
    releasesStatsRes,
    fullstackStatsRes,
    dashboardStatsRes,
    exploreStatsRes,
    promptLabStatsRes,
    researchStatsRes,
    graphStatsRes,
    inventoryStatsRes,
    healthStatsRes,
    fixesStatsRes,
    repoStatsRes,
    mcpStatsRes,
    marketplaceStatsRes,
    settingsStatsRes,
    costsStatsRes,
    ssoStatsRes,
    complianceStatsRes,
    storageStatsRes,
    queryStatsRes,
    integrationsStatsRes,
    featureBoardStatsRes,
    skillsStatsRes,
  ] = await Promise.all([
    apiFetch<LessonsStats>('/v1/admin/lessons/stats'),
    apiFetch<DriftStats>('/v1/admin/drift/stats'),
    apiFetch<AnomaliesStats>('/v1/admin/anomalies/stats'),
    apiFetch<IterateStats>('/v1/admin/pdca/stats'),
    apiFetch<OnboardingStats>('/v1/admin/onboarding/stats'),
    apiFetch<RewardsStats>('/v1/admin/rewards/stats'),
    apiFetch<BillingStats>('/v1/admin/billing/stats'),
    apiFetch<AuditStatsResp>('/v1/admin/audit/stats'),
    projectId
      ? apiFetch<QaCoverageStats>(`/v1/admin/projects/${projectId}/qa-coverage/stats`)
      : Promise.resolve({ ok: false as const, error: { code: 'SKIP', message: '' } }),
    apiFetch<CodeHealthStats>('/v1/admin/code-health/stats'),
    apiFetch<ContentQualityStats>('/v1/admin/content-quality/stats'),
    apiFetch<ExperimentsStats>('/v1/admin/experiments/stats'),
    apiFetch<IntelligenceStats>('/v1/admin/intelligence/stats'),
    apiFetch<ReleasesStats>('/v1/admin/releases/stats'),
    apiFetch<FullstackAuditStats>('/v1/admin/fullstack-audit/stats'),
    apiFetch<DashboardStats>('/v1/admin/dashboard/stats'),
    apiFetch<ExploreStats>('/v1/admin/explore/stats'),
    apiFetch<PromptLabStats>('/v1/admin/prompt-lab/stats'),
    apiFetch<ResearchStats>('/v1/admin/research/stats'),
    apiFetch<GraphStats>('/v1/admin/graph/stats'),
    apiFetch<InventoryStats>('/v1/admin/inventory/stats'),
    apiFetch<HealthStats>('/v1/admin/health/stats'),
    apiFetch<FixesStats>('/v1/admin/fixes/stats'),
    apiFetch<RepoStats>('/v1/admin/repo/stats'),
    apiFetch<McpNavSlice>('/v1/admin/mcp/stats'),
    apiFetch<MarketplaceNavSlice>('/v1/admin/marketplace/stats'),
    apiFetch<SettingsNavSlice>('/v1/admin/settings/stats'),
    projectId
      ? apiFetch<CostsNavSlice>(`/v1/admin/costs/stats?project_id=${encodeURIComponent(projectId)}`)
      : Promise.resolve({ ok: false as const, error: { code: 'SKIP', message: '' } }),
    apiFetch<SsoNavSlice>('/v1/admin/sso/stats'),
    apiFetch<ComplianceNavSlice>('/v1/admin/compliance/stats'),
    apiFetch<StorageNavSlice>('/v1/admin/storage/stats'),
    apiFetch<QueryNavSlice>('/v1/admin/query/stats'),
    apiFetch<IntegrationsNavSlice>('/v1/admin/integrations/stats'),
    apiFetch<FeatureBoardNavSlice>('/v1/admin/feature-board/stats'),
    apiFetch<SkillsNavSlice>('/v1/admin/skills/stats'),
  ])

  const lessonsStats = lessonsStatsRes.ok ? lessonsStatsRes.data : null
  const driftStats = driftStatsRes.ok ? driftStatsRes.data : null
  const anomaliesStats = anomaliesStatsRes.ok ? anomaliesStatsRes.data : null
  const iterateStats = iterateStatsRes.ok ? iterateStatsRes.data : null
  const onboardingStats = onboardingStatsRes.ok ? onboardingStatsRes.data : null
  const rewardsStats = rewardsStatsRes.ok ? rewardsStatsRes.data : null
  const billingStats = billingStatsRes.ok ? billingStatsRes.data : null
  const auditStats = auditStatsRes.ok ? auditStatsRes.data : null
  const qaCoverageStats = qaCoverageStatsRes.ok ? qaCoverageStatsRes.data : null
  const codeHealthStats = codeHealthStatsRes.ok ? codeHealthStatsRes.data : null
  const contentQualityStats = contentQualityStatsRes.ok ? contentQualityStatsRes.data : null
  const experimentsStats = experimentsStatsRes.ok ? experimentsStatsRes.data : null
  const intelligenceStats = intelligenceStatsRes.ok ? intelligenceStatsRes.data : null
  const releasesStats = releasesStatsRes.ok ? releasesStatsRes.data : null
  const fullstackStats = fullstackStatsRes.ok ? fullstackStatsRes.data : null
  const dashboardStats = dashboardStatsRes.ok ? dashboardStatsRes.data : null
  const exploreStats = exploreStatsRes.ok ? exploreStatsRes.data : null
  const promptLabStats = promptLabStatsRes.ok ? promptLabStatsRes.data : null
  const researchStats = researchStatsRes.ok ? researchStatsRes.data : null
  const graphStats = graphStatsRes.ok ? graphStatsRes.data : null
  const inventoryStats = inventoryStatsRes.ok ? inventoryStatsRes.data : null
  const healthStats = healthStatsRes.ok ? healthStatsRes.data : null
  const fixesStats = fixesStatsRes.ok ? fixesStatsRes.data : null
  const repoStats = repoStatsRes.ok ? repoStatsRes.data : null
  const mcpStats = mcpStatsRes.ok ? mcpStatsRes.data : null
  const marketplaceStats = marketplaceStatsRes.ok ? marketplaceStatsRes.data : null
  const settingsStats = settingsStatsRes.ok ? settingsStatsRes.data : null
  const costsStats = costsStatsRes.ok ? costsStatsRes.data : null
  const ssoStats = ssoStatsRes.ok ? ssoStatsRes.data : null
  const complianceStats = complianceStatsRes.ok ? complianceStatsRes.data : null
  const storageStats = storageStatsRes.ok ? storageStatsRes.data : null
  const queryStats = queryStatsRes.ok ? queryStatsRes.data : null
  const integrationsStats = integrationsStatsRes.ok ? integrationsStatsRes.data : null
  const featureBoardStats = featureBoardStatsRes.ok ? featureBoardStatsRes.data : null
  const skillsStats = skillsStatsRes.ok ? skillsStatsRes.data : null

  return normalizeNavSlices({
    contentQuality: contentQualityStats
      ? {
          openCount: contentQualityStats.openCount,
          inReviewCount: contentQualityStats.inReviewCount,
          regeneratingCount: contentQualityStats.regeneratingCount,
          userFlagOpenCount: contentQualityStats.userFlagOpenCount,
          failedRegenCount: contentQualityStats.failedRegenCount,
          needsAttentionCount: contentQualityStats.needsAttentionCount,
          topPriority: contentQualityStats.topPriority,
        }
      : null,
    codeHealth: codeHealthStats
      ? {
          errorCount: codeHealthStats.errorCount,
          warnCount: codeHealthStats.warnCount,
          godFileCount: codeHealthStats.godFileCount,
          hasRun: codeHealthStats.hasRun,
          topPriority: codeHealthStats.topPriority,
        }
      : null,
    qaCoverage: qaCoverageStats
      ? {
          totalStories: qaCoverageStats.totalStories,
          failingStories: qaCoverageStats.failingStories,
          pendingRuns: qaCoverageStats.pendingRuns,
          topPriority: qaCoverageStats.topPriority,
        }
      : null,
    experiments: experimentsStats
      ? {
          totalExperiments: experimentsStats.totalExperiments,
          runningCount: experimentsStats.runningCount,
          draftsReadyToLaunch: experimentsStats.draftsReadyToLaunch,
          winnersFound: experimentsStats.winnersFound,
          topPriority: experimentsStats.topPriority,
        }
      : null,
    lessons: lessonsStats
      ? {
          activeLessons: lessonsStats.activeLessons,
          readyToPromote: lessonsStats.readyToPromote,
          criticalLessons: lessonsStats.criticalLessons,
          topPriority: lessonsStats.topPriority,
        }
      : null,
    drift: driftStats
      ? {
          openFindings: driftStats.openFindings,
          criticalOpen: driftStats.criticalOpen,
          topPriority: driftStats.topPriority,
        }
      : null,
    anomalies: anomaliesStats
      ? {
          openAnomalies: anomaliesStats.openAnomalies,
          releaseRegressionOpen: anomaliesStats.releaseRegressionOpen,
          topPriority: anomaliesStats.topPriority,
        }
      : null,
    iterate: iterateStats
      ? {
          total: iterateStats.total,
          failed: iterateStats.failed,
          queued: iterateStats.queued,
          running: iterateStats.running,
          topPriority: iterateStats.topPriority,
        }
      : null,
    onboarding: onboardingStats
      ? {
          setupDone: onboardingStats.setupDone,
          requiredComplete: onboardingStats.requiredComplete,
          requiredTotal: onboardingStats.requiredTotal,
          sdkHostMismatch: onboardingStats.sdkHostMismatch,
        }
      : null,
    rewards: rewardsStats
      ? {
          openDisputesCount: rewardsStats.openDisputesCount,
          webhooksFailing: rewardsStats.webhooksFailing,
          activeContributors30d: rewardsStats.activeContributors30d,
          topPriority: rewardsStats.topPriority,
        }
      : null,
    billing: billingStats
      ? {
          pastDueProjects: billingStats.pastDueProjects,
          overQuota: billingStats.overQuota,
          approachingQuota: billingStats.approachingQuota,
          unpaidProjects: billingStats.unpaidProjects,
        }
      : null,
    audit: auditStats
      ? {
          warnCount24h: auditStats.warnCount24h ?? 0,
          failCount24h: auditStats.failCount24h ?? 0,
          events24h: auditStats.events24h ?? 0,
        }
      : null,
    intelligence: intelligenceStats
      ? {
          pendingFindings: intelligenceStats.pendingFindings,
          failedJobCount: intelligenceStats.failedJobCount,
          activeJobCount: intelligenceStats.activeJobCount,
          reportCount: intelligenceStats.reportCount,
          topPriority: intelligenceStats.topPriority,
        }
      : null,
    releases: releasesStats
      ? {
          draftCount: releasesStats.draftCount,
          creditsPending: releasesStats.creditsPending,
          totalReleases: releasesStats.totalReleases,
          topPriority: releasesStats.topPriority,
        }
      : null,
    fullstackAudit: fullstackStats
      ? {
          errorCount: fullstackStats.errorCount,
          warnCount: fullstackStats.warnCount,
          failedGateCount: fullstackStats.failedGateCount,
          topPriority: fullstackStats.topPriority,
        }
      : null,
    dashboard: dashboardStats
      ? {
          openBacklog: dashboardStats.openBacklog,
          fixesFailed: dashboardStats.fixesFailed,
          fixesInProgress: dashboardStats.fixesInProgress,
          integrationIssues: dashboardStats.integrationIssues,
          topPriority: dashboardStats.topPriority,
        }
      : null,
    explore: exploreStats
      ? {
          indexedFiles: exploreStats.indexedFiles,
          lastIndexError: exploreStats.lastIndexError,
          topPriority: exploreStats.topPriority,
        }
      : null,
    promptLab: promptLabStats
      ? {
          untestedAbCount: promptLabStats.untestedAbCount,
          promoteReadyCount: promptLabStats.promoteReadyCount,
          abTestingCount: promptLabStats.abTestingCount,
          totalPrompts: promptLabStats.totalPrompts,
          topPriority: promptLabStats.topPriority,
        }
      : null,
    research: researchStats
      ? {
          unattachedSnippets: researchStats.unattachedSnippets,
          firecrawlReady: researchStats.firecrawlReady,
          firecrawlTestStatus: researchStats.firecrawlTestStatus,
          sessions: researchStats.sessions,
          topPriority: researchStats.topPriority,
        }
      : null,
    graph: graphStats
      ? {
          regressionEdges: graphStats.regressionEdges,
          fragileComponents: graphStats.fragileComponents,
          nodeCount: graphStats.nodeCount,
          topPriority: graphStats.topPriority,
        }
      : null,
    inventory: inventoryStats
      ? {
          regressed: inventoryStats.regressed,
          openFindings: inventoryStats.openFindings,
          stub: inventoryStats.stub,
          total: inventoryStats.total,
          topPriority: inventoryStats.topPriority,
        }
      : null,
    health: healthStats
      ? {
          cronErrorCount: healthStats.cronErrorCount,
          redCount: healthStats.redCount,
          amberCount: healthStats.amberCount,
          topPriority: healthStats.topPriority,
        }
      : null,
    fixes: fixesStats
      ? {
          failed: fixesStats.failed,
          inProgress: fixesStats.inProgress,
          specWarnings: fixesStats.specWarnings,
          topPriority: fixesStats.topPriority,
        }
      : null,
    repo: repoStats
      ? {
          prOpen: repoStats.prOpen,
          ciFailed: repoStats.ciFailed,
          topPriority: repoStats.topPriority,
        }
      : null,
    mcp: mcpStats,
    marketplace: marketplaceStats,
    settings: settingsStats,
    costs: costsStats,
    sso: ssoStats,
    compliance: complianceStats,
    storage: storageStats,
    query: queryStats,
    integrations: integrationsStats,
    featureBoard: featureBoardStats,
    skills: skillsStats,
  })
}

export { EMPTY_NAV_STAT_SLICES }
