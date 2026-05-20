/**
 * FILE: apps/admin/src/components/drift/DriftStatsTypes.ts
 * PURPOSE: Drift shell stats — banner + DRIFT SNAPSHOT strip.
 */

export type DriftTabId = 'overview' | 'findings' | 'snapshots' | 'scanner'

export type DriftTopPriority =
  | 'no_project'
  | 'critical_findings'
  | 'warn_findings'
  | 'never_scanned'
  | 'stale_scan'
  | 'healthy'

export interface DriftStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  openFindings: number
  criticalOpen: number
  warnOpen: number
  infoOpen: number
  dismissedFindings: number
  snapshotCount: number
  lastSnapshotAt: string | null
  lastSnapshotEdges: number
  edgeCountDelta: number | null
  surfacesWithFindings: number
  lastFindingAt: string | null
  topPriority: DriftTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_DRIFT_STATS: DriftStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  openFindings: 0,
  criticalOpen: 0,
  warnOpen: 0,
  infoOpen: 0,
  dismissedFindings: 0,
  snapshotCount: 0,
  lastSnapshotAt: null,
  lastSnapshotEdges: 0,
  edgeCountDelta: null,
  surfacesWithFindings: 0,
  lastFindingAt: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
