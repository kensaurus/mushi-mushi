/**
 * FILE: apps/admin/src/components/qa-coverage/QaCoverageStatsTypes.ts
 * PURPOSE: QA Coverage shell stats — banner + QA SNAPSHOT strip.
 */

export type QaCoverageTabId = 'overview' | 'stories' | 'failing'

export type QaCoverageTopPriority =
  | 'no_project'
  | 'no_stories'
  | 'failing'
  | 'pending'
  | 'no_runs'
  | 'disabled_all'
  | 'healthy'

export interface QaCoverageStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  totalStories: number
  enabledStories: number
  disabledStories: number
  passingStories: number
  failingStories: number
  noDataStories: number
  avgPassRatePct: number | null
  totalRuns24h: number
  pendingRuns: number
  lastRunAt: string | null
  topFailingStoryId: string | null
  topFailingStoryName: string | null
  topFailingPassRatePct: number | null
  topPriority: QaCoverageTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_QA_COVERAGE_STATS: QaCoverageStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  totalStories: 0,
  enabledStories: 0,
  disabledStories: 0,
  passingStories: 0,
  failingStories: 0,
  noDataStories: 0,
  avgPassRatePct: null,
  totalRuns24h: 0,
  pendingRuns: 0,
  lastRunAt: null,
  topFailingStoryId: null,
  topFailingStoryName: null,
  topFailingPassRatePct: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
