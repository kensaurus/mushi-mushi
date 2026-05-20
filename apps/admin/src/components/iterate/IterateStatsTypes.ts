/**
 * FILE: apps/admin/src/components/iterate/IterateStatsTypes.ts
 * PURPOSE: Iterate shell stats — banner + PDCA SNAPSHOT strip.
 */

export type IterateTabId = 'overview' | 'runs' | 'new'

export type IterateTopPriority =
  | 'no_project'
  | 'active_runs'
  | 'queued_waiting'
  | 'last_failed'
  | 'no_runs'
  | 'healthy'

export interface IterateStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  total: number
  queued: number
  running: number
  succeeded: number
  failed: number
  aborted: number
  avgFinalScore: number | null
  avgFinalScorePct: number | null
  totalIterations: number
  runsMeetingTarget: number
  lastRunAt: string | null
  daysSinceLastRun: number | null
  lastFailedUrl: string | null
  lastFailedAt: string | null
  topPriority: IterateTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_ITERATE_STATS: IterateStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  total: 0,
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  aborted: 0,
  avgFinalScore: null,
  avgFinalScorePct: null,
  totalIterations: 0,
  runsMeetingTarget: 0,
  lastRunAt: null,
  daysSinceLastRun: null,
  lastFailedUrl: null,
  lastFailedAt: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
