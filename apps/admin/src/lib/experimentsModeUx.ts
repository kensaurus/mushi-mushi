/**
 * FILE: apps/admin/src/lib/experimentsModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Experiments page.
 */

import { useAdminMode } from './mode'
import type { ExperimentsStats, ExperimentsTabId } from '../components/experiments/ExperimentsStatsTypes'

export interface ExperimentsUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideExperimentsSnapshot: boolean
}

export function useExperimentsUx(): ExperimentsUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideExperimentsSnapshot: isQuickstart,
  }
}

/** Quick mode: land on experiments list or create form. */
export function resolveQuickExperimentsTab(stats: ExperimentsStats): ExperimentsTabId {
  if (stats.topPriority === 'running') return 'experiments'
  if (stats.topPriority === 'draft_ready' || stats.topPriority === 'draft_incomplete') return 'experiments'
  if (stats.topPriority === 'winners_found') return 'experiments'
  if (stats.topPriority === 'no_experiments') return 'new'
  if (stats.totalExperiments > 0) return 'experiments'
  return 'new'
}
