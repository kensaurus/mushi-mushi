/**
 * FILE: apps/admin/src/lib/inventoryModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Inventory page.
 */

import { useAdminMode } from './mode'
import type { InventoryStats, InventoryTabId } from '../components/inventory/InventoryStatsTypes'

export interface InventoryUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideInventorySnapshot: boolean
}

export function useInventoryUx(): InventoryUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: true,
    hideInventorySnapshot: isQuickstart,
  }
}

/** Quick mode: land on the tab that matches inventory posture. */
export function resolveQuickInventoryTab(stats: InventoryStats): InventoryTabId {
  if (!stats.hasInventory) return 'discovery'
  if (stats.topPriority === 'regressed') return 'stories'
  if (stats.topPriority === 'open_findings') return 'gates'
  if (stats.topPriority === 'stub_heavy') return 'tree'
  if (stats.topPriority === 'discovery_ready') return 'discovery'
  if (stats.userStories > 0) return 'stories'
  return 'overview'
}
