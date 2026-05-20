/**
 * FILE: apps/admin/src/components/lessons/LessonsStatsTypes.ts
 * PURPOSE: Lessons shell stats — banner + LESSONS SNAPSHOT strip.
 */

export type LessonsTabId = 'overview' | 'lessons' | 'clusters' | 'query'

export type LessonsTopPriority =
  | 'no_project'
  | 'candidates_ready'
  | 'critical_lessons'
  | 'no_data'
  | 'no_lessons'
  | 'healthy'

export interface LessonsStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  activeLessons: number
  retiredLessons: number
  criticalLessons: number
  candidateClusters: number
  promotedClusters: number
  readyToPromote: number
  highCoherenceCandidates: number
  totalClusterReports: number
  lastLessonReinforcedAt: string | null
  topPriority: LessonsTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_LESSONS_STATS: LessonsStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  activeLessons: 0,
  retiredLessons: 0,
  criticalLessons: 0,
  candidateClusters: 0,
  promotedClusters: 0,
  readyToPromote: 0,
  highCoherenceCandidates: 0,
  totalClusterReports: 0,
  lastLessonReinforcedAt: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
