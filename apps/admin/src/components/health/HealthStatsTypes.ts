/**
 * FILE: apps/admin/src/components/health/HealthStatsTypes.ts
 * PURPOSE: Health shell stats — banner + HEALTH SNAPSHOT strip.
 */

export type HealthTabId = 'overview' | 'llm' | 'cron' | 'activity'

export type HealthTopPriority =
  | 'no_project'
  | 'llm_errors'
  | 'cron_error'
  | 'llm_fallbacks'
  | 'cron_stale'
  | 'idle'
  | 'cron_warn'
  | 'healthy'

export interface HealthStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  window: string
  totalCalls: number
  errorRatePct: number
  fallbackRatePct: number
  avgLatencyMs: number
  p95LatencyMs: number
  cronJobCount: number
  cronHealthyCount: number
  cronErrorCount: number
  cronStaleCount: number
  cronWarnCount: number
  redCount: number
  amberCount: number
  lastLlmCallAt: string | null
  topPriority: HealthTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_HEALTH_STATS: HealthStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  window: '24h',
  totalCalls: 0,
  errorRatePct: 0,
  fallbackRatePct: 0,
  avgLatencyMs: 0,
  p95LatencyMs: 0,
  cronJobCount: 3,
  cronHealthyCount: 0,
  cronErrorCount: 0,
  cronStaleCount: 0,
  cronWarnCount: 0,
  redCount: 0,
  amberCount: 0,
  lastLlmCallAt: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
