/**
 * FILE: apps/admin/src/lib/exploreModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Explore page.
 */

import { useAdminMode } from './mode'
import type { ExploreStats, ExploreTabId } from '../components/explore/ExploreStatsTypes'

export interface ExploreUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  hideIndexTab: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideExploreSnapshot: boolean
}

export function useExploreUx(): ExploreUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    hideIndexTab: isQuickstart || isBeginner,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideExploreSnapshot: isQuickstart,
  }
}

/** Beginner mode: Summary or Ask — not the implicit Graph default. */
export function resolveBeginnerExploreTab(stats: ExploreStats): ExploreTabId {
  if (
    stats.topPriority === 'ready' &&
    stats.withEmbeddings > 0 &&
    stats.indexedFiles > 0
  ) {
    return 'ask'
  }
  return 'overview'
}

/** Quick mode: land on the tab that matches index posture. */
export function resolveQuickExploreTab(stats: ExploreStats): ExploreTabId {
  if (
    stats.topPriority === 'error' ||
    stats.topPriority === 'not_enabled' ||
    stats.topPriority === 'empty'
  ) {
    return 'index'
  }
  if (stats.topPriority === 'ready' && stats.withEmbeddings > 0) return 'search'
  if (stats.topPriority === 'ready' || stats.topPriority === 'stale') return 'graph'
  return 'overview'
}
