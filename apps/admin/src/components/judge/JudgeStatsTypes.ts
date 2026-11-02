/**
 * FILE: apps/admin/src/components/judge/JudgeStatsTypes.ts
 * PURPOSE: Judge shell stats — banner + JUDGE SNAPSHOT strip.
 */

export type JudgeTabId = 'overview' | 'trend' | 'evaluations' | 'prompts'

export type JudgeTopPriority =
  | 'no_project'
  | 'no_evals'
  | 'low_score'
  | 'drifting'
  | 'disagreements'
  | 'stale'
  | 'healthy'

export interface JudgeStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  totalEvaluations: number
  latestWeekScore: number | null
  /** 'this week', or 'week of Sep 28' when the latest scored week is an earlier one. */
  latestWeekLabel?: string | null
  latestWeekEvalCount: number
  weekOverWeekDriftPct: number | null
  /** All time, like totalEvaluations. */
  disagreementCount: number
  disagreementRatePct: number | null
  /** Days "recent" covers below (14). Absent on an older server. */
  recentWindowDays?: number
  /** Grades and disagreements in the last recentWindowDays; null when that read failed. */
  recentEvaluations?: number | null
  recentDisagreements?: number | null
  /** Grades per week and how many agreed with the diagnosis, oldest first (12 weeks). */
  agreementWeeks?: Array<{ weekStart: string; graded: number; agreed: number }>
  agreementCapped?: boolean
  classifiedReports: number
  /** Reports judge-batch would grade now (eligible status, never judged). */
  ungradedReports: number
  promptVersionCount: number
  activePromptCount: number
  lastEvalAt: string | null
  staleHours: number | null
  topPriority: JudgeTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_JUDGE_STATS: JudgeStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  totalEvaluations: 0,
  latestWeekScore: null,
  latestWeekEvalCount: 0,
  weekOverWeekDriftPct: null,
  disagreementCount: 0,
  disagreementRatePct: null,
  classifiedReports: 0,
  ungradedReports: 0,
  promptVersionCount: 0,
  activePromptCount: 0,
  lastEvalAt: null,
  staleHours: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}

/** Stat-card title for the latest scored week: 'This week' or 'Week of Sep 28'. */
export function judgeWeekTitle(label: string | null | undefined): string {
  const l = label || 'this week'
  return l.charAt(0).toUpperCase() + l.slice(1)
}
