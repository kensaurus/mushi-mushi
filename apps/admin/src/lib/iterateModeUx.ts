/**
 * FILE: apps/admin/src/lib/iterateModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Iterate page.
 */

import { useAdminMode } from './mode'
import type { IterateStats, IterateTabId } from '../components/iterate/IterateStatsTypes'

export interface IterateUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideIterateSnapshot: boolean
}

export function useIterateUx(): IterateUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideIterateSnapshot: isQuickstart,
  }
}

/** Quick mode: monitor runs, queue new, or open runs list. */
export function resolveQuickIterateTab(stats: IterateStats): IterateTabId {
  if (stats.topPriority === 'active_runs' || stats.topPriority === 'queued_waiting') return 'runs'
  if (stats.topPriority === 'last_failed') return 'runs'
  if (stats.topPriority === 'no_runs') return 'new'
  if (stats.total > 0) return 'runs'
  return 'new'
}
