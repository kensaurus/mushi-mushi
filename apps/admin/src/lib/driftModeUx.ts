/**
 * FILE: apps/admin/src/lib/driftModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Drift page.
 */

import { useAdminMode } from './mode'
import type { DriftStats, DriftTabId } from '../components/drift/DriftStatsTypes'

export interface DriftUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideDriftSnapshot: boolean
}

export function useDriftUx(): DriftUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideDriftSnapshot: isQuickstart,
  }
}

/** Quick mode: jump to findings or scanner based on drift posture. */
export function resolveQuickDriftTab(stats: DriftStats): DriftTabId {
  if (stats.topPriority === 'critical_findings' || stats.topPriority === 'warn_findings') return 'findings'
  if (stats.topPriority === 'never_scanned' || stats.topPriority === 'stale_scan') return 'scanner'
  if (stats.openFindings > 0) return 'findings'
  return 'scanner'
}
