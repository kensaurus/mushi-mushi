/**
 * FILE: apps/admin/src/lib/anomaliesModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Anomalies page.
 */

import { useAdminMode } from './mode'
import type { AnomaliesStats, AnomaliesTabId } from '../components/anomalies/AnomaliesStatsTypes'

export interface AnomaliesUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideAnomaliesSnapshot: boolean
}

export function useAnomaliesUx(): AnomaliesUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideAnomaliesSnapshot: isQuickstart,
  }
}

/** Quick mode: land on triage, ingest, or detect based on posture. */
export function resolveQuickAnomaliesTab(stats: AnomaliesStats): AnomaliesTabId {
  if (stats.topPriority === 'open_critical' || stats.topPriority === 'open_anomalies') return 'anomalies'
  if (stats.topPriority === 'no_metrics') return 'metrics'
  if (stats.openAnomalies > 0) return 'anomalies'
  if (stats.metricPointCount === 0) return 'metrics'
  return 'detect'
}
