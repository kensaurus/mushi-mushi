/**
 * FILE: skillsModeUx.ts
 * PURPOSE: Mode-aware UX flags for the Skill Pipelines page.
 *
 * OVERVIEW:
 * - Quick/Beginner/Advanced chrome budget for /skills tabs, snapshot, and readout
 *
 * DEPENDENCIES:
 * - useAdminMode from ./mode
 * - SkillsStats from ../components/skills/SkillsStatsTypes
 *
 * USAGE:
 * - const ux = useSkillsUx() in SkillPipelinesPage
 */

import { useAdminMode } from './mode'
import type { SkillsStats } from '../components/skills/SkillsStatsTypes'

export type SkillsTabId = 'catalog' | 'pipelines' | 'sources'

export interface SkillsUxFlags {
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
  /** Hide Catalog / Pipelines / Sources tabs — jump via banner CTAs in Quick mode. */
  hideTabs: boolean
  /** Plain-language status banner CTAs. */
  plainBanner: boolean
  /** Hide SKILLS SNAPSHOT KPI strip in Quick mode. */
  hideSkillsSnapshot: boolean
  /** Hide API endpoint readout on Sources (Advanced only). */
  hideEndpointReadout: boolean
}

export function useSkillsUx(): SkillsUxFlags {
  const { isQuickstart, isBeginner, isAdvanced } = useAdminMode()
  return {
    isQuickstart,
    isBeginner,
    isAdvanced,
    hideTabs: isQuickstart,
    plainBanner: !isAdvanced,
    hideSkillsSnapshot: isQuickstart,
    hideEndpointReadout: !isAdvanced,
  }
}

/** Quick mode: jump to the tab that matches pipeline posture. */
export function resolveQuickSkillsTab(stats: SkillsStats): SkillsTabId {
  if (stats.topPriority === 'failed_runs' || stats.topPriority === 'awaiting_checkin') {
    return 'pipelines'
  }
  if (stats.topPriority === 'empty_catalog') return 'sources'
  if (stats.topPriority === 'active_runs') return 'pipelines'
  return 'catalog'
}
