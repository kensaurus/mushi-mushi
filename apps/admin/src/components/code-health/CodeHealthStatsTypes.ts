/**
 * Lightweight code-health slice for sidebar nav badges.
 * Full page data lives on GET /v1/admin/code-health.
 */

export type CodeHealthTopPriority =
  | 'no_project'
  | 'no_data'
  | 'errors'
  | 'warnings'
  | 'healthy'

export interface CodeHealthStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  errorCount: number
  warnCount: number
  godFileCount: number
  hasRun: boolean
  latestRunAt: string | null
  topPriority: CodeHealthTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_CODE_HEALTH_STATS: CodeHealthStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  errorCount: 0,
  warnCount: 0,
  godFileCount: 0,
  hasRun: false,
  latestRunAt: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
