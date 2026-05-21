/**
 * FILE: apps/admin/src/lib/marketplaceModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Marketplace page.
 */

import { useAdminMode } from './mode'
import type { MarketplaceStats, MarketplaceTabId } from '../components/marketplace/types'

export interface MarketplaceUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideMarketplaceSnapshot: boolean
}

export function useMarketplaceUx(): MarketplaceUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideMarketplaceSnapshot: isQuickstart,
  }
}

/** Quick mode: jump to the tab that matches plugin delivery posture. */
export function resolveQuickMarketplaceTab(stats: MarketplaceStats): MarketplaceTabId {
  if (stats.topPriority === 'delivery_failures') return 'deliveries'
  if (stats.topPriority === 'plugins_paused') return 'installed'
  if (stats.topPriority === 'no_plugins_installed') return 'browse'
  if (stats.installedTotal > 0) return 'installed'
  return 'browse'
}
