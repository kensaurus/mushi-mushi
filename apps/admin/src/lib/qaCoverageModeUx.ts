/**
 * FILE: qaCoverageModeUx.ts
 * PURPOSE: Mode-aware UX flags for the QA Coverage page.
 */

import { useAdminMode } from './mode'

export interface QaCoverageUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideQaSnapshot: boolean
  compactSnapshot: boolean
  hideSnapshotLinks: boolean
  /** PagePosture status banner replaces inline PageHero (Wave 5). */
  hideOverviewChrome: boolean
}

export function useQaCoverageUx(): QaCoverageUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideQaSnapshot: isQuickstart,
    compactSnapshot: isQuickstart || isBeginner,
    hideSnapshotLinks: !isAdvanced,
    hideOverviewChrome: true,
  }
}
