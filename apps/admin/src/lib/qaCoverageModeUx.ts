/**
 * FILE: apps/admin/src/lib/qaCoverageModeUx.ts
 * PURPOSE: Mode-aware UX flags for the QA Coverage page.
 */

import { useAdminMode } from './mode'
import type { QaCoverageStats, QaCoverageTabId } from '../components/qa-coverage/QaCoverageStatsTypes'

export interface QaCoverageUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideQaSnapshot: boolean
}

export function useQaCoverageUx(): QaCoverageUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideQaSnapshot: isQuickstart,
  }
}

/** Quick mode: land on the tab that matches QA posture. */
export function resolveQuickQaCoverageTab(stats: QaCoverageStats): QaCoverageTabId {
  if (stats.topPriority === 'failing') return 'failing'
  if (stats.topPriority === 'pending' || stats.topPriority === 'no_runs' || stats.topPriority === 'disabled_all') {
    return 'stories'
  }
  if (stats.totalStories > 0) return 'stories'
  return 'overview'
}
