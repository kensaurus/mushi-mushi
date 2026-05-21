/**
 * FILE: apps/admin/src/lib/lessonsModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Lessons page.
 */

import { useAdminMode } from './mode'
import type { LessonsStats, LessonsTabId } from '../components/lessons/LessonsStatsTypes'

export interface LessonsUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  hideTabs: boolean
  plainBanner: boolean
  hideOverviewChrome: boolean
  hideLessonsSnapshot: boolean
}

export function useLessonsUx(): LessonsUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideOverviewChrome: !isAdvanced,
    hideLessonsSnapshot: isQuickstart,
  }
}

/** Quick mode: land on the tab that matches lesson memory posture. */
export function resolveQuickLessonsTab(stats: LessonsStats): LessonsTabId {
  if (stats.topPriority === 'critical_lessons') return 'lessons'
  if (stats.topPriority === 'candidates_ready' || stats.topPriority === 'no_lessons') return 'clusters'
  if (stats.activeLessons > 0) return 'lessons'
  if (stats.readyToPromote > 0) return 'clusters'
  return 'overview'
}
