/**
 * FILE: apps/admin/src/lib/costModeUx.ts
 * PURPOSE: Mode-aware UX flags for the LLM Cost page.
 */

import { useAdminMode } from './mode'
import type { CostStats, CostTabId } from '../components/cost/types'

export interface CostUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideCostSnapshot: boolean
}

export function useCostUx(): CostUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideCostSnapshot: isQuickstart,
  }
}

/** Quick mode: land on the panel that matches spend posture. */
export function resolveQuickCostTab(stats: CostStats): CostTabId {
  if (stats.spendSpike24h || stats.failedCalls24h > 0) return 'log'
  if (stats.totalCalls > 0) return 'breakdown'
  return 'overview'
}
