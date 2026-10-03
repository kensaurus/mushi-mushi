/**
 * Lightweight full-stack audit slice for sidebar nav badges.
 */

export type FullstackAuditTopPriority =
  | 'no_project'
  | 'failures'
  | 'warnings'
  | 'healthy'
  /** A read failed: the counts are not known (see readError). Never healthy. */
  | 'unknown'

export interface FullstackAuditStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  errorCount: number
  warnCount: number
  failedGateCount: number
  topPriority: FullstackAuditTopPriority
  /** Plain-English reason when topPriority is `unknown`. */
  readError?: string | null
}

export const EMPTY_FULLSTACK_AUDIT_STATS: FullstackAuditStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  errorCount: 0,
  warnCount: 0,
  failedGateCount: 0,
  topPriority: 'no_project',
}
