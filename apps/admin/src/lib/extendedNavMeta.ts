/**
 * FILE: apps/admin/src/lib/extendedNavMeta.ts
 * PURPOSE: Badge derivation for Check / Act / Workspace nav items beyond
 *          the core PDCA counters already in useNavCounts.
 */

import type { AnomaliesStats } from '../components/anomalies/AnomaliesStatsTypes'
import type { BillingStats } from '../components/billing/types'
import type { CodeHealthStats } from '../components/code-health/CodeHealthStatsTypes'
import type { ContentQualityStats } from '../components/content-quality/ContentQualityStatsTypes'
import type { DashboardStats } from '../components/dashboard/DashboardStatsTypes'
import type { DriftStats } from '../components/drift/DriftStatsTypes'
import type { ExperimentsStats } from '../components/experiments/ExperimentsStatsTypes'
import type { ExploreStats } from '../components/explore/ExploreStatsTypes'
import type { FixesStats } from '../components/fixes/FixesStatsTypes'
import type { FullstackAuditStats } from '../components/fullstack-audit/FullstackAuditStatsTypes'
import type { GraphStats } from '../components/graph/GraphStatsTypes'
import type { HealthStats } from '../components/health/HealthStatsTypes'
import type { IntelligenceStats } from '../components/intelligence/IntelligenceStatsTypes'
import type { InventoryStats } from '../components/inventory/InventoryStatsTypes'
import type { IterateStats } from '../components/iterate/IterateStatsTypes'
import type { LessonsStats } from '../components/lessons/LessonsStatsTypes'
import type { OnboardingStats } from '../components/onboarding/types'
import type { PromptLabStats } from '../components/prompt-lab/PromptLabStatsTypes'
import type { QaCoverageStats } from '../components/qa-coverage/QaCoverageStatsTypes'
import type { RepoStats } from '../components/repo/RepoStatsTypes'
import type { ResearchStats } from '../components/research/ResearchStatsTypes'
import type { RewardsStats } from '../components/rewards/types'
import type { ReleasesStats } from '../components/releases/ReleasesStatsTypes'
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
import type { HealthTone } from './useNavCounts'
import type { WorkspaceNavBadge } from './workspaceNavMeta'

export interface AuditNavSlice {
  warnCount24h: number
  failCount24h: number
  events24h: number
}

export interface NavStatSlices {
  contentQuality: Pick<
    ContentQualityStats,
    | 'openCount'
    | 'inReviewCount'
    | 'regeneratingCount'
    | 'userFlagOpenCount'
    | 'failedRegenCount'
    | 'needsAttentionCount'
    | 'topPriority'
  > | null
  codeHealth: Pick<
    CodeHealthStats,
    'errorCount' | 'warnCount' | 'godFileCount' | 'hasRun' | 'topPriority'
  > | null
  qaCoverage: Pick<
    QaCoverageStats,
    'totalStories' | 'failingStories' | 'pendingRuns' | 'topPriority'
  > | null
  experiments: Pick<
    ExperimentsStats,
    'totalExperiments' | 'runningCount' | 'draftsReadyToLaunch' | 'winnersFound' | 'topPriority'
  > | null
  lessons: Pick<
    LessonsStats,
    'activeLessons' | 'readyToPromote' | 'criticalLessons' | 'topPriority'
  > | null
  drift: Pick<DriftStats, 'openFindings' | 'criticalOpen' | 'topPriority'> | null
  anomalies: Pick<
    AnomaliesStats,
    'openAnomalies' | 'releaseRegressionOpen' | 'topPriority'
  > | null
  iterate: Pick<
    IterateStats,
    'total' | 'failed' | 'queued' | 'running' | 'topPriority'
  > | null
  onboarding: Pick<
    OnboardingStats,
    'setupDone' | 'requiredComplete' | 'requiredTotal' | 'sdkHostMismatch'
  > | null
  rewards: Pick<
    RewardsStats,
    'openDisputesCount' | 'webhooksFailing' | 'activeContributors30d' | 'topPriority'
  > | null
  billing: Pick<
    BillingStats,
    'pastDueProjects' | 'overQuota' | 'approachingQuota' | 'unpaidProjects'
  > | null
  audit: AuditNavSlice | null
  intelligence: Pick<
    IntelligenceStats,
    'pendingFindings' | 'failedJobCount' | 'activeJobCount' | 'reportCount' | 'topPriority'
  > | null
  releases: Pick<
    ReleasesStats,
    'draftCount' | 'creditsPending' | 'totalReleases' | 'topPriority'
  > | null
  fullstackAudit: Pick<
    FullstackAuditStats,
    'errorCount' | 'warnCount' | 'failedGateCount' | 'topPriority'
  > | null
  dashboard: Pick<
    DashboardStats,
    'openBacklog' | 'fixesFailed' | 'fixesInProgress' | 'integrationIssues' | 'topPriority'
  > | null
  explore: Pick<ExploreStats, 'indexedFiles' | 'lastIndexError' | 'topPriority'> | null
  promptLab: Pick<
    PromptLabStats,
    | 'untestedAbCount'
    | 'promoteReadyCount'
    | 'abTestingCount'
    | 'totalPrompts'
    | 'topPriority'
  > | null
  research: Pick<
    ResearchStats,
    | 'unattachedSnippets'
    | 'firecrawlReady'
    | 'firecrawlTestStatus'
    | 'sessions'
    | 'topPriority'
  > | null
  graph: Pick<
    GraphStats,
    'regressionEdges' | 'fragileComponents' | 'nodeCount' | 'topPriority'
  > | null
  inventory: Pick<
    InventoryStats,
    'regressed' | 'openFindings' | 'stub' | 'total' | 'topPriority'
  > | null
  health: Pick<
    HealthStats,
    'cronErrorCount' | 'redCount' | 'amberCount' | 'topPriority'
  > | null
  fixes: Pick<FixesStats, 'failed' | 'inProgress' | 'specWarnings' | 'topPriority'> | null
  repo: Pick<RepoStats, 'prOpen' | 'ciFailed' | 'topPriority'> | null
  mcp: McpNavSlice | null
  marketplace: MarketplaceNavSlice | null
  settings: SettingsNavSlice | null
  costs: CostsNavSlice | null
  sso: SsoNavSlice | null
  compliance: ComplianceNavSlice | null
  storage: StorageNavSlice | null
  query: QueryNavSlice | null
  integrations: IntegrationsNavSlice | null
  featureBoard: FeatureBoardNavSlice | null
  skills: SkillsNavSlice | null
}

export const EMPTY_NAV_STAT_SLICES: NavStatSlices = {
  contentQuality: null,
  codeHealth: null,
  qaCoverage: null,
  experiments: null,
  lessons: null,
  drift: null,
  anomalies: null,
  iterate: null,
  onboarding: null,
  rewards: null,
  billing: null,
  audit: null,
  intelligence: null,
  releases: null,
  fullstackAudit: null,
  dashboard: null,
  explore: null,
  promptLab: null,
  research: null,
  graph: null,
  inventory: null,
  health: null,
  fixes: null,
  repo: null,
  mcp: null,
  marketplace: null,
  settings: null,
  costs: null,
  sso: null,
  compliance: null,
  storage: null,
  query: null,
  integrations: null,
  featureBoard: null,
  skills: null,
}

function attentionBadge(
  count: number,
  tone: HealthTone,
  label: string,
): WorkspaceNavBadge {
  return { mode: 'attention', count, tone, label }
}

function inventoryBadge(count: number, label: string): WorkspaceNavBadge {
  return { mode: 'inventory', count, label }
}

export function contentQualityNavBadge(
  stats: NavStatSlices['contentQuality'],
): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.failedRegenCount > 0) {
    return attentionBadge(
      stats.failedRegenCount,
      'danger',
      `${stats.failedRegenCount} content regen ${stats.failedRegenCount === 1 ? 'failure' : 'failures'}`,
    )
  }
  if (stats.userFlagOpenCount > 0) {
    return attentionBadge(
      stats.userFlagOpenCount,
      'danger',
      `${stats.userFlagOpenCount} user-flagged content asset${stats.userFlagOpenCount === 1 ? '' : 's'}`,
    )
  }
  if (stats.needsAttentionCount > 0) {
    return attentionBadge(
      stats.needsAttentionCount,
      'warn',
      `${stats.needsAttentionCount} content asset${stats.needsAttentionCount === 1 ? '' : 's'} need review`,
    )
  }
  if (stats.regeneratingCount > 0) {
    return attentionBadge(
      stats.regeneratingCount,
      'ok',
      `${stats.regeneratingCount} content regen${stats.regeneratingCount === 1 ? '' : 's'} in flight`,
    )
  }
  return null
}

export function codeHealthNavBadge(stats: NavStatSlices['codeHealth']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.errorCount > 0) {
    return attentionBadge(
      stats.errorCount,
      'danger',
      `${stats.errorCount} code-health error${stats.errorCount === 1 ? '' : 's'}`,
    )
  }
  if (stats.warnCount > 0) {
    return attentionBadge(
      stats.warnCount,
      'warn',
      `${stats.warnCount} code-health warning${stats.warnCount === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function experimentsNavBadge(
  stats: NavStatSlices['experiments'],
): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.draftsReadyToLaunch > 0) {
    return attentionBadge(
      stats.draftsReadyToLaunch,
      'warn',
      `${stats.draftsReadyToLaunch} experiment draft${stats.draftsReadyToLaunch === 1 ? '' : 's'} ready to launch`,
    )
  }
  if (stats.runningCount > 0) {
    return attentionBadge(
      stats.runningCount,
      'ok',
      `${stats.runningCount} experiment${stats.runningCount === 1 ? '' : 's'} running`,
    )
  }
  if (stats.winnersFound > 0 && stats.topPriority === 'winners_found') {
    return attentionBadge(
      stats.winnersFound,
      'warn',
      `${stats.winnersFound} experiment winner${stats.winnersFound === 1 ? '' : 's'} to review`,
    )
  }
  if (stats.totalExperiments > 0 && stats.topPriority === 'healthy') {
    return inventoryBadge(
      stats.totalExperiments,
      `${stats.totalExperiments} experiment${stats.totalExperiments === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function qaCoverageNavBadge(
  stats: NavStatSlices['qaCoverage'],
): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.failingStories > 0) {
    return attentionBadge(
      stats.failingStories,
      'danger',
      `${stats.failingStories} QA stor${stats.failingStories === 1 ? 'y' : 'ies'} below 80% pass rate`,
    )
  }
  if (stats.pendingRuns > 0) {
    return attentionBadge(
      stats.pendingRuns,
      'warn',
      `${stats.pendingRuns} QA run${stats.pendingRuns === 1 ? '' : 's'} queued or in progress`,
    )
  }
  if (stats.totalStories > 0 && stats.topPriority === 'healthy') {
    return inventoryBadge(
      stats.totalStories,
      `${stats.totalStories} QA stor${stats.totalStories === 1 ? 'y' : 'ies'}`,
    )
  }
  return null
}

export function lessonsNavBadge(stats: NavStatSlices['lessons']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.readyToPromote > 0) {
    return attentionBadge(
      stats.readyToPromote,
      'warn',
      `${stats.readyToPromote} lesson cluster${stats.readyToPromote === 1 ? '' : 's'} ready to promote`,
    )
  }
  if (stats.criticalLessons > 0) {
    return attentionBadge(
      stats.criticalLessons,
      'danger',
      `${stats.criticalLessons} critical lesson${stats.criticalLessons === 1 ? '' : 's'}`,
    )
  }
  if (stats.activeLessons > 0) {
    return inventoryBadge(
      stats.activeLessons,
      `${stats.activeLessons} active lesson${stats.activeLessons === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function driftNavBadge(stats: NavStatSlices['drift']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.criticalOpen > 0) {
    return attentionBadge(
      stats.criticalOpen,
      'danger',
      `${stats.criticalOpen} critical drift finding${stats.criticalOpen === 1 ? '' : 's'}`,
    )
  }
  if (stats.openFindings > 0) {
    return attentionBadge(
      stats.openFindings,
      'warn',
      `${stats.openFindings} open drift finding${stats.openFindings === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function anomaliesNavBadge(stats: NavStatSlices['anomalies']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.releaseRegressionOpen > 0) {
    return attentionBadge(
      stats.releaseRegressionOpen,
      'danger',
      `${stats.releaseRegressionOpen} release regression${stats.releaseRegressionOpen === 1 ? '' : 's'}`,
    )
  }
  if (stats.openAnomalies > 0) {
    return attentionBadge(
      stats.openAnomalies,
      'warn',
      `${stats.openAnomalies} open anomal${stats.openAnomalies === 1 ? 'y' : 'ies'}`,
    )
  }
  return null
}

export function iterateNavBadge(stats: NavStatSlices['iterate']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.failed > 0) {
    return attentionBadge(
      stats.failed,
      'danger',
      `${stats.failed} failed PDCA run${stats.failed === 1 ? '' : 's'}`,
    )
  }
  const active = stats.queued + stats.running
  if (active > 0) {
    return attentionBadge(
      active,
      'ok',
      `${active} PDCA run${active === 1 ? '' : 's'} in flight`,
    )
  }
  if (stats.total > 0 && stats.topPriority === 'healthy') {
    return inventoryBadge(stats.total, `${stats.total} PDCA run${stats.total === 1 ? '' : 's'}`)
  }
  return null
}

export function onboardingNavBadge(
  stats: NavStatSlices['onboarding'],
): WorkspaceNavBadge | null {
  if (!stats || stats.setupDone) return null
  const remaining = Math.max(0, stats.requiredTotal - stats.requiredComplete)
  if (remaining <= 0 && !stats.sdkHostMismatch) return null
  const count = stats.sdkHostMismatch ? remaining + 1 : remaining
  const label = stats.sdkHostMismatch
    ? 'Setup incomplete · SDK endpoint mismatch'
    : `${remaining} required setup step${remaining === 1 ? '' : 's'} remaining`
  return attentionBadge(count, stats.sdkHostMismatch ? 'danger' : 'warn', label)
}

export function rewardsNavBadge(stats: NavStatSlices['rewards']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.openDisputesCount > 0) {
    return attentionBadge(
      stats.openDisputesCount,
      'danger',
      `${stats.openDisputesCount} open reward dispute${stats.openDisputesCount === 1 ? '' : 's'}`,
    )
  }
  if (stats.webhooksFailing > 0) {
    return attentionBadge(
      stats.webhooksFailing,
      'warn',
      `${stats.webhooksFailing} failing reward webhook${stats.webhooksFailing === 1 ? '' : 's'}`,
    )
  }
  if (stats.activeContributors30d > 0 && stats.topPriority === 'healthy') {
    return inventoryBadge(
      stats.activeContributors30d,
      `${stats.activeContributors30d} active contributor${stats.activeContributors30d === 1 ? '' : 's'} (30d)`,
    )
  }
  return null
}

export function billingNavBadge(stats: NavStatSlices['billing']): WorkspaceNavBadge | null {
  if (!stats) return null
  const attention =
    stats.pastDueProjects + stats.unpaidProjects + (stats.overQuota ? 1 : 0)
  if (attention > 0) {
    const parts: string[] = []
    if (stats.pastDueProjects > 0) parts.push(`${stats.pastDueProjects} past due`)
    if (stats.unpaidProjects > 0) parts.push(`${stats.unpaidProjects} unpaid`)
    if (stats.overQuota) parts.push('over quota')
    return attentionBadge(attention, 'danger', parts.join(' · '))
  }
  if (stats.approachingQuota) {
    return attentionBadge(1, 'warn', 'Approaching report quota')
  }
  return null
}

export function auditNavBadge(stats: NavStatSlices['audit']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.failCount24h > 0) {
    return attentionBadge(
      stats.failCount24h,
      'danger',
      `${stats.failCount24h} failed audit event${stats.failCount24h === 1 ? '' : 's'} (24h)`,
    )
  }
  if (stats.warnCount24h > 0) {
    return attentionBadge(
      stats.warnCount24h,
      'warn',
      `${stats.warnCount24h} audit warning${stats.warnCount24h === 1 ? '' : 's'} (24h)`,
    )
  }
  if (stats.events24h > 0) {
    return inventoryBadge(stats.events24h, `${stats.events24h} audit events (24h)`)
  }
  return null
}

export function intelligenceNavBadge(
  stats: NavStatSlices['intelligence'],
): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.failedJobCount > 0) {
    return attentionBadge(
      stats.failedJobCount,
      'danger',
      `${stats.failedJobCount} failed intelligence job${stats.failedJobCount === 1 ? '' : 's'}`,
    )
  }
  if (stats.pendingFindings > 0) {
    return attentionBadge(
      stats.pendingFindings,
      'warn',
      `${stats.pendingFindings} pending intelligence finding${stats.pendingFindings === 1 ? '' : 's'}`,
    )
  }
  if (stats.activeJobCount > 0) {
    return attentionBadge(
      stats.activeJobCount,
      'ok',
      `${stats.activeJobCount} intelligence job${stats.activeJobCount === 1 ? '' : 's'} running`,
    )
  }
  if (stats.reportCount > 0 && stats.topPriority === 'healthy') {
    return inventoryBadge(
      stats.reportCount,
      `${stats.reportCount} intelligence report${stats.reportCount === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function releasesNavBadge(stats: NavStatSlices['releases']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.creditsPending > 0) {
    return attentionBadge(
      stats.creditsPending,
      'warn',
      `${stats.creditsPending} release credit${stats.creditsPending === 1 ? '' : 's'} pending notify`,
    )
  }
  if (stats.draftCount > 0 && stats.topPriority === 'drafts_pending') {
    return attentionBadge(
      stats.draftCount,
      'warn',
      `${stats.draftCount} release draft${stats.draftCount === 1 ? '' : 's'} pending publish`,
    )
  }
  if (stats.topPriority === 'ready_to_draft') {
    return attentionBadge(1, 'warn', 'Fixed reports ready — draft a release')
  }
  if (stats.totalReleases > 0 && stats.topPriority === 'healthy') {
    return inventoryBadge(
      stats.totalReleases,
      `${stats.totalReleases} release${stats.totalReleases === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function fullstackAuditNavBadge(
  stats: NavStatSlices['fullstackAudit'],
): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.errorCount > 0 || stats.failedGateCount > 0) {
    const count = Math.max(stats.errorCount, stats.failedGateCount)
    return attentionBadge(
      count,
      'danger',
      `${count} full-stack audit ${count === 1 ? 'failure' : 'failures'}`,
    )
  }
  if (stats.warnCount > 0) {
    return attentionBadge(
      stats.warnCount,
      'warn',
      `${stats.warnCount} full-stack audit warning${stats.warnCount === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function dashboardNavBadge(stats: NavStatSlices['dashboard']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.fixesFailed > 0) {
    return attentionBadge(
      stats.fixesFailed,
      'danger',
      `${stats.fixesFailed} failed fix${stats.fixesFailed === 1 ? '' : 'es'} on dashboard`,
    )
  }
  if (stats.integrationIssues > 0) {
    return attentionBadge(
      stats.integrationIssues,
      'warn',
      `${stats.integrationIssues} integration issue${stats.integrationIssues === 1 ? '' : 's'}`,
    )
  }
  if (stats.openBacklog > 0 && stats.topPriority === 'backlog') {
    return attentionBadge(
      stats.openBacklog,
      'warn',
      `${stats.openBacklog} open report${stats.openBacklog === 1 ? '' : 's'} in backlog`,
    )
  }
  if (stats.fixesInProgress > 0) {
    return attentionBadge(
      stats.fixesInProgress,
      'ok',
      `${stats.fixesInProgress} fix${stats.fixesInProgress === 1 ? '' : 'es'} in progress`,
    )
  }
  return null
}

export function exploreNavBadge(stats: NavStatSlices['explore']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.topPriority === 'error' || stats.lastIndexError) {
    return attentionBadge(1, 'danger', 'Codebase index error — open Explore')
  }
  if (stats.topPriority === 'stale') {
    return attentionBadge(1, 'warn', 'Codebase index stale — re-index recommended')
  }
  if (stats.topPriority === 'indexing') {
    return attentionBadge(1, 'ok', 'Codebase index in progress')
  }
  if (stats.indexedFiles > 0 && stats.topPriority === 'ready') {
    return inventoryBadge(
      stats.indexedFiles,
      `${stats.indexedFiles.toLocaleString()} indexed file${stats.indexedFiles === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function promptLabNavBadge(stats: NavStatSlices['promptLab']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.untestedAbCount > 0) {
    return attentionBadge(
      stats.untestedAbCount,
      'warn',
      `${stats.untestedAbCount} A/B prompt${stats.untestedAbCount === 1 ? '' : 's'} untested`,
    )
  }
  if (stats.promoteReadyCount > 0) {
    return attentionBadge(
      stats.promoteReadyCount,
      'warn',
      `${stats.promoteReadyCount} prompt${stats.promoteReadyCount === 1 ? '' : 's'} ready to promote`,
    )
  }
  if (stats.abTestingCount > 0) {
    return attentionBadge(
      stats.abTestingCount,
      'ok',
      `${stats.abTestingCount} A/B test${stats.abTestingCount === 1 ? '' : 's'} running`,
    )
  }
  if (stats.totalPrompts > 0 && stats.topPriority === 'healthy') {
    return inventoryBadge(
      stats.totalPrompts,
      `${stats.totalPrompts} prompt${stats.totalPrompts === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function researchNavBadge(stats: NavStatSlices['research']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.topPriority === 'firecrawl_auth_failed' || stats.topPriority === 'firecrawl_error') {
    return attentionBadge(1, 'danger', 'Research Firecrawl connection failed')
  }
  if (stats.topPriority === 'firecrawl_not_configured' || stats.topPriority === 'firecrawl_untested') {
    return attentionBadge(1, 'warn', 'Configure Firecrawl for Research')
  }
  if (stats.unattachedSnippets > 0) {
    return attentionBadge(
      stats.unattachedSnippets,
      'warn',
      `${stats.unattachedSnippets} unattached research snippet${stats.unattachedSnippets === 1 ? '' : 's'}`,
    )
  }
  if (stats.sessions > 0 && stats.topPriority === 'healthy') {
    return inventoryBadge(
      stats.sessions,
      `${stats.sessions} research session${stats.sessions === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function graphNavBadge(stats: NavStatSlices['graph']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.regressionEdges > 0) {
    return attentionBadge(
      stats.regressionEdges,
      'danger',
      `${stats.regressionEdges} regression edge${stats.regressionEdges === 1 ? '' : 's'} in graph`,
    )
  }
  if (stats.fragileComponents > 0) {
    return attentionBadge(
      stats.fragileComponents,
      'warn',
      `${stats.fragileComponents} fragile graph component${stats.fragileComponents === 1 ? '' : 's'}`,
    )
  }
  if (stats.nodeCount > 0 && stats.topPriority === 'clear') {
    return inventoryBadge(
      stats.nodeCount,
      `${stats.nodeCount.toLocaleString()} graph node${stats.nodeCount === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function inventoryNavBadge(stats: NavStatSlices['inventory']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.regressed > 0) {
    return attentionBadge(
      stats.regressed,
      'danger',
      `${stats.regressed} regressed inventory action${stats.regressed === 1 ? '' : 's'}`,
    )
  }
  if (stats.openFindings > 0) {
    return attentionBadge(
      stats.openFindings,
      'warn',
      `${stats.openFindings} open inventory finding${stats.openFindings === 1 ? '' : 's'}`,
    )
  }
  if (stats.stub > 0 && stats.topPriority === 'stub_heavy') {
    return attentionBadge(
      stats.stub,
      'warn',
      `${stats.stub} stub inventory node${stats.stub === 1 ? '' : 's'}`,
    )
  }
  if (stats.total > 0 && stats.topPriority === 'clear') {
    return inventoryBadge(stats.total, `${stats.total} inventory node${stats.total === 1 ? '' : 's'}`)
  }
  return null
}

export function healthStatsNavBadge(stats: NavStatSlices['health']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.cronErrorCount > 0 || stats.topPriority === 'cron_error' || stats.topPriority === 'llm_errors') {
    const count = Math.max(stats.cronErrorCount, stats.redCount, 1)
    return attentionBadge(count, 'danger', `${count} health check${count === 1 ? '' : 's'} failing`)
  }
  if (stats.amberCount > 0 || stats.topPriority === 'cron_warn' || stats.topPriority === 'cron_stale') {
    return attentionBadge(
      Math.max(stats.amberCount, 1),
      'warn',
      `${stats.amberCount || 1} health warning${stats.amberCount === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function fixesStatsNavBadge(stats: NavStatSlices['fixes']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.failed > 0) {
    return attentionBadge(
      stats.failed,
      'danger',
      `${stats.failed} failed fix attempt${stats.failed === 1 ? '' : 's'}`,
    )
  }
  if (stats.inProgress > 0) {
    return attentionBadge(
      stats.inProgress,
      'ok',
      `${stats.inProgress} fix${stats.inProgress === 1 ? '' : 'es'} in progress`,
    )
  }
  if (stats.specWarnings > 0) {
    return attentionBadge(
      stats.specWarnings,
      'warn',
      `${stats.specWarnings} fix spec warning${stats.specWarnings === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function repoStatsNavBadge(stats: NavStatSlices['repo']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.ciFailed > 0) {
    return attentionBadge(
      stats.ciFailed,
      'danger',
      `${stats.ciFailed} repo CI failure${stats.ciFailed === 1 ? '' : 's'}`,
    )
  }
  if (stats.prOpen > 0) {
    return attentionBadge(
      stats.prOpen,
      'ok',
      `${stats.prOpen} open PR${stats.prOpen === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function mcpNavBadge(stats: NavStatSlices['mcp']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.endpointMismatch) {
    return attentionBadge(1, 'danger', 'MCP endpoint mismatch — check API URL')
  }
  if (stats.reportOnlyKeyCount > 0 && stats.mcpReadKeyCount === 0) {
    return attentionBadge(
      stats.reportOnlyKeyCount,
      'warn',
      'No MCP-scoped API key — add mcp:read key',
    )
  }
  if (stats.neverConnectedCount > 0 && stats.mcpReadKeyCount > 0) {
    return attentionBadge(
      stats.neverConnectedCount,
      'warn',
      `${stats.neverConnectedCount} MCP key${stats.neverConnectedCount === 1 ? '' : 's'} never connected`,
    )
  }
  if (stats.mcpReadKeyCount > 0 && stats.topPriority === 'healthy') {
    return inventoryBadge(
      stats.mcpReadKeyCount,
      `${stats.mcpReadKeyCount} MCP key${stats.mcpReadKeyCount === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function marketplaceNavBadge(
  stats: NavStatSlices['marketplace'],
): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.failingPlugins > 0 || stats.deliveriesFailed > 0) {
    const count = Math.max(stats.failingPlugins, stats.deliveriesFailed)
    return attentionBadge(
      count,
      'danger',
      `${count} plugin delivery failure${count === 1 ? '' : 's'}`,
    )
  }
  if (stats.neverDeliveredPlugins > 0) {
    return attentionBadge(
      stats.neverDeliveredPlugins,
      'warn',
      `${stats.neverDeliveredPlugins} active plugin${stats.neverDeliveredPlugins === 1 ? '' : 's'} never delivered`,
    )
  }
  if (stats.installedActive > 0 && stats.topPriority === 'healthy') {
    return inventoryBadge(
      stats.installedActive,
      `${stats.installedActive} installed plugin${stats.installedActive === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function settingsNavBadge(stats: NavStatSlices['settings']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.byokKeysFailing > 0) {
    return attentionBadge(
      stats.byokKeysFailing,
      'danger',
      `${stats.byokKeysFailing} BYOK key${stats.byokKeysFailing === 1 ? '' : 's'} failing probe`,
    )
  }
  if (stats.byokKeysUntested > 0) {
    return attentionBadge(
      stats.byokKeysUntested,
      'warn',
      `${stats.byokKeysUntested} BYOK key${stats.byokKeysUntested === 1 ? '' : 's'} untested`,
    )
  }
  if (stats.byokKeysConfigured > 0) {
    return inventoryBadge(
      stats.byokKeysConfigured,
      `${stats.byokKeysConfigured} BYOK key${stats.byokKeysConfigured === 1 ? '' : 's'} configured`,
    )
  }
  return null
}

export function costsNavBadge(stats: NavStatSlices['costs']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.spendSpike24h) {
    return attentionBadge(1, 'warn', 'LLM spend spike in last 24h')
  }
  if (stats.failedCalls24h > 0) {
    return attentionBadge(
      stats.failedCalls24h,
      'danger',
      `${stats.failedCalls24h} failed LLM call${stats.failedCalls24h === 1 ? '' : 's'} (24h)`,
    )
  }
  if (stats.calls24h > 0) {
    return inventoryBadge(
      stats.calls24h,
      `${stats.calls24h} LLM call${stats.calls24h === 1 ? '' : 's'} (24h)`,
    )
  }
  return null
}

export function ssoNavBadge(stats: NavStatSlices['sso']): WorkspaceNavBadge | null {
  if (!stats || !stats.ssoEntitlement) return null
  if (stats.failedCount > 0) {
    return attentionBadge(
      stats.failedCount,
      'danger',
      `${stats.failedCount} SSO registration failure${stats.failedCount === 1 ? '' : 's'}`,
    )
  }
  if (stats.manualRequiredCount > 0) {
    return attentionBadge(
      stats.manualRequiredCount,
      'warn',
      `${stats.manualRequiredCount} SSO config${stats.manualRequiredCount === 1 ? '' : 's'} need manual setup`,
    )
  }
  if (stats.pendingCount > 0) {
    return attentionBadge(
      stats.pendingCount,
      'ok',
      `${stats.pendingCount} SSO registration${stats.pendingCount === 1 ? '' : 's'} pending`,
    )
  }
  return null
}

export function complianceNavBadge(
  stats: NavStatSlices['compliance'],
): WorkspaceNavBadge | null {
  if (!stats || !stats.soc2Entitlement) return null
  if (stats.overdueDsars > 0) {
    return attentionBadge(
      stats.overdueDsars,
      'danger',
      `${stats.overdueDsars} overdue DSAR${stats.overdueDsars === 1 ? '' : 's'}`,
    )
  }
  if (stats.controlsFail > 0) {
    return attentionBadge(
      stats.controlsFail,
      'danger',
      `${stats.controlsFail} SOC 2 control${stats.controlsFail === 1 ? '' : 's'} failing`,
    )
  }
  if (stats.atRiskDsars > 0 || stats.controlsWarn > 0) {
    const count = stats.atRiskDsars + stats.controlsWarn
    return attentionBadge(count, 'warn', `${count} compliance item${count === 1 ? '' : 's'} need attention`)
  }
  return null
}

export function storageNavBadge(stats: NavStatSlices['storage']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.failingCount > 0 || stats.activeProjectHealthStatus === 'failing') {
    const count = Math.max(stats.failingCount, 1)
    return attentionBadge(
      count,
      'danger',
      `${count} storage backend${count === 1 ? '' : 's'} failing`,
    )
  }
  if (stats.degradedCount > 0 || stats.activeProjectHealthStatus === 'degraded') {
    return attentionBadge(
      Math.max(stats.degradedCount, 1),
      'warn',
      `${stats.degradedCount || 1} storage backend${stats.degradedCount === 1 ? '' : 's'} degraded`,
    )
  }
  if (stats.neverProbedCount > 0) {
    return attentionBadge(
      stats.neverProbedCount,
      'warn',
      `${stats.neverProbedCount} storage config${stats.neverProbedCount === 1 ? '' : 's'} never probed`,
    )
  }
  return null
}

export function queryNavBadge(stats: NavStatSlices['query']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.schemaDegraded) {
    return attentionBadge(1, 'warn', 'Query history schema degraded')
  }
  if (stats.errors24h > 0) {
    return attentionBadge(
      stats.errors24h,
      'danger',
      `${stats.errors24h} failed NL quer${stats.errors24h === 1 ? 'y' : 'ies'} (24h)`,
    )
  }
  if (stats.savedCount > 0) {
    return inventoryBadge(
      stats.savedCount,
      `${stats.savedCount} saved quer${stats.savedCount === 1 ? 'y' : 'ies'}`,
    )
  }
  if (stats.runs24h > 0) {
    return inventoryBadge(
      stats.runs24h,
      `${stats.runs24h} quer${stats.runs24h === 1 ? 'y' : 'ies'} (24h)`,
    )
  }
  return null
}

export function integrationsNavBadge(
  stats: NavStatSlices['integrations'],
): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.platformDown > 0) {
    return attentionBadge(
      stats.platformDown,
      'danger',
      `${stats.platformDown} integration${stats.platformDown === 1 ? '' : 's'} down`,
    )
  }
  const disconnected = stats.platformTotal - stats.platformConnected
  if (disconnected > 0 && stats.platformConnected === 0) {
    return attentionBadge(
      disconnected,
      'warn',
      `${disconnected} platform integration${disconnected === 1 ? '' : 's'} not configured`,
    )
  }
  if (stats.routingPaused > 0) {
    return attentionBadge(
      stats.routingPaused,
      'warn',
      `${stats.routingPaused} routing integration${stats.routingPaused === 1 ? '' : 's'} paused`,
    )
  }
  if (stats.platformConnected > 0) {
    return inventoryBadge(
      stats.platformConnected,
      `${stats.platformConnected} platform integration${stats.platformConnected === 1 ? '' : 's'} connected`,
    )
  }
  return null
}

export function featureBoardNavBadge(
  stats: NavStatSlices['featureBoard'],
): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.trendingCount > 0) {
    return attentionBadge(
      stats.trendingCount,
      'warn',
      `${stats.trendingCount} trending feature request${stats.trendingCount === 1 ? '' : 's'}`,
    )
  }
  if (stats.openCount > 0) {
    return inventoryBadge(
      stats.openCount,
      `${stats.openCount} open feature request${stats.openCount === 1 ? '' : 's'}`,
    )
  }
  return null
}

export function skillsNavBadge(stats: NavStatSlices['skills']): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.failedRuns > 0) {
    return attentionBadge(
      stats.failedRuns,
      'danger',
      `${stats.failedRuns} failed skill pipeline run${stats.failedRuns === 1 ? '' : 's'}`,
    )
  }
  if (stats.awaitingCheckin > 0) {
    return attentionBadge(
      stats.awaitingCheckin,
      'warn',
      `${stats.awaitingCheckin} pipeline step${stats.awaitingCheckin === 1 ? '' : 's'} awaiting check-in`,
    )
  }
  if (stats.activeRuns > 0) {
    return attentionBadge(
      stats.activeRuns,
      'ok',
      `${stats.activeRuns} skill pipeline${stats.activeRuns === 1 ? '' : 's'} running`,
    )
  }
  if (stats.catalogTotal > 0) {
    return inventoryBadge(
      stats.catalogTotal,
      `${stats.catalogTotal} skill${stats.catalogTotal === 1 ? '' : 's'} in catalog`,
    )
  }
  return null
}

export function usersNavBadge(stats: {
  signups7d: number
  churn30d: number
} | null): WorkspaceNavBadge | null {
  if (!stats) return null
  if (stats.churn30d > 0) {
    return attentionBadge(
      stats.churn30d,
      'warn',
      `${stats.churn30d} churned user${stats.churn30d === 1 ? '' : 's'} (30d)`,
    )
  }
  if (stats.signups7d > 0) {
    return inventoryBadge(
      stats.signups7d,
      `${stats.signups7d} signup${stats.signups7d === 1 ? '' : 's'} (7d)`,
    )
  }
  return null
}

export function startSectionAttention(slices: NavStatSlices): {
  count: number
  tone: 'warn' | 'danger'
  label: string
} | null {
  let count = 0
  const parts: string[] = []
  const setup = onboardingNavBadge(slices.onboarding)
  if (setup?.mode === 'attention') {
    count += setup.count
    parts.push(setup.label)
  }
  const dash = dashboardNavBadge(slices.dashboard)
  if (dash?.mode === 'attention' && dash.tone !== 'ok') {
    count += dash.count
    parts.push(`${dash.count} dashboard`)
  }
  const featureBoard = featureBoardNavBadge(slices.featureBoard)
  if (featureBoard?.mode === 'attention') {
    count += featureBoard.count
    parts.push(`${featureBoard.count} feature board`)
  }
  if (count === 0) return null
  const tone = [setup, dash, featureBoard].some((b) => b?.tone === 'danger') ? 'danger' : 'warn'
  return { count, tone, label: parts.join(' · ') }
}

export function planSectionAttention(slices: NavStatSlices): {
  count: number
  tone: 'warn' | 'danger'
  label: string
} | null {
  const content = contentQualityNavBadge(slices.contentQuality)
  if (!content || content.mode !== 'attention' || content.tone === 'ok') return null
  return {
    count: content.count,
    tone: content.tone === 'danger' ? 'danger' : 'warn',
    label: content.label,
  }
}

export function checkSectionAttention(slices: NavStatSlices): {
  count: number
  tone: 'warn' | 'danger'
  label: string
} | null {
  let count = 0
  const parts: string[] = []
  const codeHealth = codeHealthNavBadge(slices.codeHealth)
  if (codeHealth?.mode === 'attention') {
    count += codeHealth.count
    parts.push(`${codeHealth.count} code health`)
  }
  const fullstack = fullstackAuditNavBadge(slices.fullstackAudit)
  if (fullstack?.mode === 'attention') {
    count += fullstack.count
    parts.push(`${fullstack.count} audit`)
  }
  const qa = qaCoverageNavBadge(slices.qaCoverage)
  if (qa?.mode === 'attention') {
    count += qa.count
    parts.push(`${qa.count} QA`)
  }
  const lessons = lessonsNavBadge(slices.lessons)
  if (lessons?.mode === 'attention') {
    count += lessons.count
    parts.push(`${lessons.count} lessons`)
  }
  const drift = driftNavBadge(slices.drift)
  if (drift?.mode === 'attention') {
    count += drift.count
    parts.push(`${drift.count} drift`)
  }
  const anomalies = anomaliesNavBadge(slices.anomalies)
  if (anomalies?.mode === 'attention') {
    count += anomalies.count
    parts.push(`${anomalies.count} anomalies`)
  }
  const intelligence = intelligenceNavBadge(slices.intelligence)
  if (intelligence?.mode === 'attention' && intelligence.tone !== 'ok') {
    count += intelligence.count
    parts.push(`${intelligence.count} intelligence`)
  }
  const releases = releasesNavBadge(slices.releases)
  if (releases?.mode === 'attention') {
    count += releases.count
    parts.push(`${releases.count} releases`)
  }
  const explore = exploreNavBadge(slices.explore)
  if (explore?.mode === 'attention' && explore.tone !== 'ok') {
    count += explore.count
    parts.push(`${explore.count} explore`)
  }
  const research = researchNavBadge(slices.research)
  if (research?.mode === 'attention' && research.tone !== 'ok') {
    count += research.count
    parts.push(`${research.count} research`)
  }
  const health = healthStatsNavBadge(slices.health)
  if (health?.mode === 'attention' && health.tone !== 'ok') {
    count += health.count
    parts.push(`${health.count} health`)
  }
  if (count === 0) return null
  const tone = [codeHealth, fullstack, qa, lessons, drift, anomalies, intelligence, releases, explore, research, health].some(
    (b) => b?.tone === 'danger',
  )
    ? 'danger'
    : 'warn'
  return { count, tone, label: parts.join(' · ') }
}

export function doSectionAttention(slices: NavStatSlices): {
  count: number
  tone: 'warn' | 'danger'
  label: string
} | null {
  let count = 0
  const parts: string[] = []
  const fixes = fixesStatsNavBadge(slices.fixes)
  if (fixes?.mode === 'attention' && fixes.tone !== 'ok') {
    count += fixes.count
    parts.push(`${fixes.count} fixes`)
  }
  const repo = repoStatsNavBadge(slices.repo)
  if (repo?.mode === 'attention' && repo.tone !== 'ok') {
    count += repo.count
    parts.push(`${repo.count} repo`)
  }
  const promptLab = promptLabNavBadge(slices.promptLab)
  if (promptLab?.mode === 'attention' && promptLab.tone !== 'ok') {
    count += promptLab.count
    parts.push(`${promptLab.count} prompt lab`)
  }
  if (count === 0) return null
  const tone = [fixes, repo, promptLab].some((b) => b?.tone === 'danger') ? 'danger' : 'warn'
  return { count, tone, label: parts.join(' · ') }
}

export function actSectionAttention(slices: NavStatSlices): {
  count: number
  tone: 'warn' | 'danger'
  label: string
} | null {
  let count = 0
  const parts: string[] = []
  const rewards = rewardsNavBadge(slices.rewards)
  if (rewards?.mode === 'attention') {
    count += rewards.count
    parts.push(`${rewards.count} rewards`)
  }
  const iterate = iterateNavBadge(slices.iterate)
  if (iterate?.mode === 'attention' && iterate.tone !== 'ok') {
    count += iterate.count
    parts.push(`${iterate.count} PDCA`)
  }
  const mcp = mcpNavBadge(slices.mcp)
  if (mcp?.mode === 'attention' && mcp.tone !== 'ok') {
    count += mcp.count
    parts.push(`${mcp.count} MCP`)
  }
  const marketplace = marketplaceNavBadge(slices.marketplace)
  if (marketplace?.mode === 'attention' && marketplace.tone !== 'ok') {
    count += marketplace.count
    parts.push(`${marketplace.count} marketplace`)
  }
  const integrations = integrationsNavBadge(slices.integrations)
  if (integrations?.mode === 'attention' && integrations.tone !== 'ok') {
    count += integrations.count
    parts.push(`${integrations.count} integrations`)
  }
  const skills = skillsNavBadge(slices.skills)
  if (skills?.mode === 'attention' && skills.tone !== 'ok') {
    count += skills.count
    parts.push(`${skills.count} skills`)
  }
  if (count === 0) return null
  const tone = [rewards, iterate, mcp, marketplace, integrations, skills].some(
    (b) => b?.tone === 'danger',
  )
    ? 'danger'
    : 'warn'
  return { count, tone, label: parts.join(' · ') }
}

export function workspaceSlicesAttention(slices: NavStatSlices): {
  count: number
  tone: 'warn' | 'danger'
  label: string
} | null {
  let count = 0
  const parts: string[] = []
  const badges = [
    settingsNavBadge(slices.settings),
    costsNavBadge(slices.costs),
    ssoNavBadge(slices.sso),
    complianceNavBadge(slices.compliance),
    storageNavBadge(slices.storage),
    queryNavBadge(slices.query),
  ]
  for (const badge of badges) {
    if (badge?.mode === 'attention' && badge.tone !== 'ok') {
      count += badge.count
      parts.push(badge.label)
    }
  }
  if (count === 0) return null
  const tone = badges.some((b) => b?.tone === 'danger') ? 'danger' : 'warn'
  return { count, tone, label: parts.join(' · ') }
}
