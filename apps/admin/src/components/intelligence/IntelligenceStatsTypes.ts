/**
 * FILE: apps/admin/src/components/intelligence/IntelligenceStatsTypes.ts
 * PURPOSE: Intelligence shell stats — banner + INTELLIGENCE SNAPSHOT strip.
 */

export type IntelligenceTabId = 'overview' | 'reports' | 'pipeline'

export type IntelligenceTopPriority =
  | 'no_project'
  | 'feature_locked'
  | 'job_running'
  | 'job_failed'
  | 'stale_digest'
  | 'no_reports'
  | 'pending_findings'
  | 'healthy'

export interface IntelligenceStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  featureUnlocked: boolean
  planName: string | null
  reportCount: number
  latestReportAt: string | null
  latestWeekStart: string | null
  daysSinceLastDigest: number | null
  totalReportsInLatest: number
  totalFixAttempts: number
  fixCompletionRatePct: number
  activeJobCount: number
  failedJobCount: number
  completedJobCount: number
  lastJobStatus: string | null
  lastJobError: string | null
  lastJobAt: string | null
  pendingFindings: number
  securityFindings: number
  benchmarkOptIn: boolean
  topPriority: IntelligenceTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_INTELLIGENCE_STATS: IntelligenceStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  featureUnlocked: false,
  planName: null,
  reportCount: 0,
  latestReportAt: null,
  latestWeekStart: null,
  daysSinceLastDigest: null,
  totalReportsInLatest: 0,
  totalFixAttempts: 0,
  fixCompletionRatePct: 0,
  activeJobCount: 0,
  failedJobCount: 0,
  completedJobCount: 0,
  lastJobStatus: null,
  lastJobError: null,
  lastJobAt: null,
  pendingFindings: 0,
  securityFindings: 0,
  benchmarkOptIn: false,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
