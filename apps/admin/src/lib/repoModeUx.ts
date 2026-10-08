/**
 * FILE: apps/admin/src/lib/repoModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Repo page.
 */

import { useAdminMode } from './mode'

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
