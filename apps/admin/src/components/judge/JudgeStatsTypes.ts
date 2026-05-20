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
  latestWeekEvalCount: number
  weekOverWeekDriftPct: number | null
  disagreementCount: number
  disagreementRatePct: number | null
  classifiedReports: number
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
  promptVersionCount: 0,
  activePromptCount: 0,
  lastEvalAt: null,
  staleHours: null,
  topPriority: 'no_project',
  topPriorityLabel: null,
  topPriorityTo: null,
}
