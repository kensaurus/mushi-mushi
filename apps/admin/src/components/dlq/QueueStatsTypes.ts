/**
 * FILE: apps/admin/src/components/dlq/QueueStatsTypes.ts
 * PURPOSE: Queue shell stats — banner + QUEUE SNAPSHOT strip.
 */

export type QueueTabId = 'overview' | 'backlog' | 'throughput' | 'items'

export type QueueTopPriority =
  | 'no_project'
  | 'dead_letter'
  | 'failed'
  | 'circuit_breaker'
  | 'stalled'
  | 'healthy'

export interface QueueStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  pending: number
  running: number
  completed: number
  failed: number
  deadLetter: number
  reportsQueued: number
  strandedReports: number
  oldestPendingMinutes: number | null
  topStage: string | null
  topStageDeadLetter: number
  todayCreated: number
  todayCompleted: number
  todayFailed: number
  topPriority: QueueTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_QUEUE_STATS: QueueStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  pending: 0,
  running: 0,
  completed: 0,
  failed: 0,
  deadLetter: 0,
  reportsQueued: 0,
  strandedReports: 0,
  oldestPendingMinutes: null,
  topStage: null,
  topStageDeadLetter: 0,
  todayCreated: 0,
  todayCompleted: 0,
  todayFailed: 0,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
