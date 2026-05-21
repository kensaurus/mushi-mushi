/**
 * FILE: apps/admin/src/lib/intelligenceModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Intelligence page.
 */

import { useAdminMode } from './mode'
import type { IntelligenceStats, IntelligenceTabId } from '../components/intelligence/IntelligenceStatsTypes'

export interface IntelligenceUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideIntelligenceSnapshot: boolean
}

export function useIntelligenceUx(): IntelligenceUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideIntelligenceSnapshot: isQuickstart,
  }
}

/** Quick mode: jump to pipeline when jobs/findings need attention, else reports. */
export function resolveQuickIntelligenceTab(stats: IntelligenceStats): IntelligenceTabId {
  if (
    stats.topPriority === 'job_failed' ||
    stats.topPriority === 'job_running' ||
    stats.topPriority === 'pending_findings'
  ) {
    return 'pipeline'
  }
  if (stats.topPriority === 'no_reports' || stats.topPriority === 'stale_digest' || stats.topPriority === 'feature_locked') {
    return 'overview'
  }
  if (stats.reportCount > 0) return 'reports'
  return 'overview'
}
