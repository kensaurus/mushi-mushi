/**
 * FILE: apps/admin/src/lib/repoModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Repo page.
 */

import { useAdminMode } from './mode'
import type { RepoStats, RepoTabId } from '../components/repo/RepoStatsTypes'

export interface RepoUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideRepoSnapshot: boolean
}

export function useRepoUx(): RepoUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideRepoSnapshot: isQuickstart,
  }
}

/** Quick mode: jump to the panel that matches repo posture. */
export function resolveQuickRepoTab(stats: RepoStats): RepoTabId {
  if (stats.topPriority === 'ci_failing' || stats.topPriority === 'stuck') return 'branches'
  if (stats.topPriority === 'healthy' && stats.totalBranches > 0) return 'branches'
  return 'overview'
}
