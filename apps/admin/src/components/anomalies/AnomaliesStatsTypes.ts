/**
 * FILE: apps/admin/src/components/anomalies/AnomaliesStatsTypes.ts
 * PURPOSE: Anomalies shell stats — banner + ANOMALIES SNAPSHOT strip.
 */

export type AnomaliesTabId = 'overview' | 'anomalies' | 'metrics' | 'detect'

export type AnomaliesTopPriority =
  | 'no_project'
  | 'open_critical'
  | 'open_anomalies'
  | 'no_metrics'
  | 'healthy'

export interface AnomaliesStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  openAnomalies: number
  confirmedAnomalies: number
  dismissedAnomalies: number
  autoReported: number
  releaseRegressionOpen: number
  highScoreOpen: number
  metricPointCount: number
  distinctMetrics: number
  lastDetectionAt: string | null
  lastMetricAt: string | null
  topPriority: AnomaliesTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_ANOMALIES_STATS: AnomaliesStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  openAnomalies: 0,
  confirmedAnomalies: 0,
  dismissedAnomalies: 0,
  autoReported: 0,
  releaseRegressionOpen: 0,
  highScoreOpen: 0,
  metricPointCount: 0,
  distinctMetrics: 0,
  lastDetectionAt: null,
  lastMetricAt: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
