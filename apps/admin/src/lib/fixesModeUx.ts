/**
 * FILE: apps/admin/src/lib/fixesModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Fixes page — keeps Quick/Beginner
 *          surfaces simple without scattering `useAdminMode()` branches.
 */

import { useAdminMode } from './mode'
import type { FixesStats, FixesTabId } from '../components/fixes/FixesStatsTypes'

export interface FixesUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  /** Hide Pipeline + CI/Agent columns in the attempts table. */
  compactTable: boolean
  /** Hide Overview / Pipeline tabs — attempts list only. */
  hideTabs: boolean
  /** Use plain-language status banner CTAs. */
  plainBanner: boolean
  /** Hide table density toggle + PDCA jargon in table chrome. */
  hideTableChrome: boolean
  /** Hide failed-category drill-down chips (keep count banner). */
  hideFailureCategories: boolean
  /** Hide snapshot footer links (Judge, Releases, …). */
  hideSnapshotLinks: boolean
  /** Hide FIXES SNAPSHOT KPI strip in Quick mode. */
  hideFixesSnapshot: boolean
}

export function useFixesUx(): FixesUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    compactTable: !isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideTableChrome: !isAdvanced,
    hideFailureCategories: isQuickstart,
    hideSnapshotLinks: !isAdvanced,
    hideFixesSnapshot: isQuickstart,
  }
}

/** Quick mode: jump to the panel that matches pipeline posture. */
export function resolveQuickFixesTab(stats: FixesStats): FixesTabId {
  if (stats.topPriority === 'failed') return 'attempts'
  if (stats.topPriority === 'inflight') return 'pipeline'
  if (stats.topPriority === 'no_github' || stats.topPriority === 'no_index') return 'overview'
  if (stats.topPriority === 'waiting') return 'attempts'
  return 'attempts'
}
