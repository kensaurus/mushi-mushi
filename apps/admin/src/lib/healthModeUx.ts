/**
 * FILE: apps/admin/src/lib/healthModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Health page.
 */

import { useAdminMode } from './mode'
import type { HealthStats, HealthTabId } from '../components/health/HealthStatsTypes'

export interface HealthUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideHealthSnapshot: boolean
}

export function useHealthUx(): HealthUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: true,
    hideHealthSnapshot: isQuickstart,
  }
}

/** Quick mode: land on the panel that matches the top priority. */
export function resolveQuickHealthTab(stats: HealthStats): HealthTabId {
  if (
    stats.topPriority === 'llm_errors' ||
    stats.topPriority === 'llm_fallbacks'
  ) {
    return 'llm'
  }
  if (
    stats.topPriority === 'cron_error' ||
    stats.topPriority === 'cron_stale' ||
    stats.topPriority === 'cron_warn'
  ) {
    return 'cron'
  }
  if (stats.topPriority === 'healthy' && stats.totalCalls > 0) {
    return 'activity'
  }
  return 'overview'
}
