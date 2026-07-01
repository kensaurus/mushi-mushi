/**
 * FILE: apps/admin/src/lib/judgeModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Judge page.
 */

import { useAdminMode } from './mode'
import type { JudgeStats, JudgeTabId } from '../components/judge/JudgeStatsTypes'

export interface JudgeUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  /** Quick: hide tab strip — land on the actionable panel. */
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  /** Hide JUDGE SNAPSHOT KPI strip in Quick mode. */
  hideJudgeSnapshot: boolean
}

export function useJudgeUx(): JudgeUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: true,
    hideJudgeSnapshot: isQuickstart,
  }
}

/** Quick mode: jump to evaluations when something needs review, else trend. */
export function resolveQuickJudgeTab(stats: JudgeStats): JudgeTabId {
  if (
    stats.topPriority === 'disagreements' ||
    stats.topPriority === 'low_score' ||
    stats.topPriority === 'drifting'
  ) {
    return 'evaluations'
  }
  if (stats.topPriority === 'healthy' && stats.totalEvaluations > 0) {
    return 'trend'
  }
  return 'overview'
}
