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

/**
 * Quick mode: the tab to send the user to, or null to stay. Only a visit
 * with no `?tab=` is redirected — once a tab is chosen (including "new" for
 * a second experiment) it is respected. Before 2026-10 the redirect ran on
 * every render and bounced quickstart users off the New form.
 */
export function resolveQuickExperimentsRedirect(
  stats: ExperimentsStats,
  rawTab: string | null,
): ExperimentsTabId | null {
  if (rawTab === 'experiments' || rawTab === 'new') return null
  return resolveQuickExperimentsTab(stats)
}

/** A variant weight typed in a form: a number in [0, 1], else null. */
export function parseVariantWeight(raw: string | number): number | null {
  if (typeof raw === 'string' && raw.trim() === '') return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
}
