/**
 * FILE: apps/admin/src/components/fixes/FixesStatsTypes.ts
 * PURPOSE: Fixes shell stats — banner + FIXES SNAPSHOT strip.
 */

export type FixesTabId = 'overview' | 'pipeline' | 'attempts'

export type FixesTopPriority =
  | 'no_project'
  | 'no_github'
  | 'no_index'
  | 'failed'
  | 'inflight'
  | 'waiting'
  | 'healthy'

export interface FixesStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  hasGithub: boolean
  codebaseIndexEnabled: boolean
  indexedFiles: number
  totalAttempts: number
  failed: number
  inProgress: number
  completed: number
  prsOpen: number
  prsCiPassing: number
  specWarnings: number
  inflightDispatches: number
  topFailureCategory: string | null
  topFailureCount: number
  successRatePct: number | null
  topPriority: FixesTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_FIXES_STATS: FixesStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  hasGithub: false,
  codebaseIndexEnabled: false,
  indexedFiles: 0,
  totalAttempts: 0,
  failed: 0,
  inProgress: 0,
  completed: 0,
  prsOpen: 0,
  prsCiPassing: 0,
  specWarnings: 0,
  inflightDispatches: 0,
  topFailureCategory: null,
  topFailureCount: 0,
  successRatePct: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
