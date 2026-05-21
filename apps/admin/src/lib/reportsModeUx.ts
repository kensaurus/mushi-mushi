/**
 * FILE: apps/admin/src/lib/reportsModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Reports page — keeps Quick/Beginner
 *          surfaces simple without scattering `useAdminMode()` branches
 *          across every sub-component.
 */

import { useAdminMode } from './mode'
import type { ReportsStats, ReportsTabId } from '../components/reports/ReportsStatsTypes'

export interface ReportsUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  /** Hide checkbox column + bulk bar. */
  compactTable: boolean
  /** Hide category / platform / SDK filter dropdowns. */
  simplifiedFilters: boolean
  /** Hide saved-views row. */
  hideSavedViews: boolean
  /** Hide keyboard-shortcuts chip in header. */
  hideKeyboardShortcuts: boolean
  /** Hide Overview / Severity tabs — queue only. */
  hideTabs: boolean
  /** Use plain-language status banner CTAs. */
  plainBanner: boolean
  /** Hide TRIAGE SNAPSHOT KPI strip in Quick mode. */
  hideReportsSnapshot: boolean
  /** Hide PageHero + top-priority cards on Overview. */
  hideOverviewChrome: boolean
}

export function useReportsUx(): ReportsUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    compactTable: !isAdvanced,
    simplifiedFilters: isQuickstart,
    hideSavedViews: !isAdvanced,
    hideKeyboardShortcuts: !isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideReportsSnapshot: isQuickstart,
    hideOverviewChrome: !isAdvanced,
  }
}

/** Quick mode: land on the tab that matches triage posture. */
export function resolveQuickReportsTab(stats: ReportsStats): ReportsTabId {
  if (
    stats.topPriority === 'critical' ||
    stats.topPriority === 'backlog' ||
    stats.topPriority === 'untriaged'
  ) {
    return 'queue'
  }
  if (stats.topPriority === 'waiting_ingest' || !stats.hasIngest) {
    return 'overview'
  }
  return 'queue'
}
