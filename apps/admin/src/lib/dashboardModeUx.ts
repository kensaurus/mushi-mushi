/**
 * FILE: apps/admin/src/lib/dashboardModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Dashboard page.
 */

import { useAdminMode } from './mode'
import type { DashboardStats, DashboardTabId } from '../components/dashboard/DashboardStatsTypes'

export interface DashboardUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  /** Hide Loop / Metrics / Health tabs — home overview only. */
  hideTabs: boolean
  /** Use plain-language status banner CTAs. */
  plainBanner: boolean
  /** Hide PageHero + PDCA explainer on Overview. */
  hideOverviewChrome: boolean
  /** Hide LOOP SNAPSHOT KPI strip (Quick keeps banner only). */
  hideLoopSnapshot: boolean
}

export function useDashboardUx(): DashboardUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    // Only Quickstart hides the orienting HeroIntro ("what now?"). Beginner mode
    // keeps it so a new user always has a next-action signal; Advanced renders
    // the live PdcaFlow instead. (Previously `!isAdvanced` also blanked it for
    // beginners, leaving them with neither orientation surface.)
    hideOverviewChrome: isQuickstart,
    hideLoopSnapshot: isQuickstart,
  }
}

/** Quick mode: land on the tab that matches the current bottleneck. */
export function resolveQuickDashboardTab(stats: DashboardStats): DashboardTabId {
  if (stats.topPriority === 'integrations') return 'health'
  return 'overview'
}
