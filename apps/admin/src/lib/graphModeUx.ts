/**
 * FILE: apps/admin/src/lib/graphModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Graph page.
 */

import { useAdminMode } from './mode'
import type { GraphStats, GraphTabId } from '../components/graph/GraphStatsTypes'

export interface GraphUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  /** Hide Overview / Backend tabs — map only. */
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideGraphSnapshot: boolean
}

export function useGraphUx(): GraphUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideGraphSnapshot: isQuickstart,
  }
}

export function resolveQuickGraphTab(stats: GraphStats): GraphTabId {
  if (stats.topPriority === 'fragile' || stats.topPriority === 'regressions' || stats.nodeCount > 0) {
    return 'explore'
  }
  return 'overview'
}
