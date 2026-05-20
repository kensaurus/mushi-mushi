/**
 * FILE: apps/admin/src/components/experiments/ExperimentsStatsTypes.ts
 * PURPOSE: Experiments shell stats — banner + EXPERIMENTS SNAPSHOT strip.
 */

export type ExperimentsTabId = 'overview' | 'experiments' | 'new'

export type ExperimentsTopPriority =
  | 'no_project'
  | 'no_experiments'
  | 'running'
  | 'draft_ready'
  | 'winners_found'
  | 'draft_incomplete'
  | 'healthy'

export interface ExperimentsStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  totalExperiments: number
  draftCount: number
  runningCount: number
  stoppedCount: number
  completedCount: number
  winnersFound: number
  draftsReadyToLaunch: number
  banditEnabledCount: number
  totalVariants: number
  totalAssignments: number
  totalConversions: number
  conversionRatePct: number
  lastExperimentAt: string | null
  topPriority: ExperimentsTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_EXPERIMENTS_STATS: ExperimentsStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  totalExperiments: 0,
  draftCount: 0,
  runningCount: 0,
  stoppedCount: 0,
  completedCount: 0,
  winnersFound: 0,
  draftsReadyToLaunch: 0,
  banditEnabledCount: 0,
  totalVariants: 0,
  totalAssignments: 0,
  totalConversions: 0,
  conversionRatePct: 0,
  lastExperimentAt: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
