/**
 * FILE: apps/admin/src/lib/releasesModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Releases page.
 */

import { useAdminMode } from './mode'
import type { ReleasesStats, ReleasesTabId } from '../components/releases/ReleasesStatsTypes'

export interface ReleasesUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideReleasesSnapshot: boolean
}

export function useReleasesUx(): ReleasesUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideReleasesSnapshot: isQuickstart,
  }
}

/** Quick mode: land on the tab that matches release posture. */
export function resolveQuickReleasesTab(stats: ReleasesStats): ReleasesTabId {
  if (stats.topPriority === 'drafts_pending') return 'drafts'
  if (stats.topPriority === 'ready_to_draft' || stats.topPriority === 'no_releases') return 'draft'
  if (stats.topPriority === 'healthy' && stats.publishedCount > 0) return 'published'
  return 'overview'
}
