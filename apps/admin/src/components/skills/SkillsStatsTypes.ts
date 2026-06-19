/**
 * FILE: apps/admin/src/components/skills/SkillsStatsTypes.ts
 */

export type SkillsTopPriority =
  | 'no_project'
  | 'empty_catalog'
  | 'failed_runs'
  | 'awaiting_checkin'
  | 'active_runs'
  | 'healthy'

export interface SkillsStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  catalogTotal: number
  activeRuns: number
  failedRuns: number
  awaitingCheckin: number
  topPriority: SkillsTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_SKILLS_STATS: SkillsStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  catalogTotal: 0,
  activeRuns: 0,
  failedRuns: 0,
  awaitingCheckin: 0,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
