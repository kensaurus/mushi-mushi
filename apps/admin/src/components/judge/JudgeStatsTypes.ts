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

/**
 * Same minimum as `JUDGE_RECENT_MIN_GRADES` in
 * `packages/server/supabase/functions/api/routes/judge.ts`. A 14-day window
 * with fewer grades than this is too thin to quote; the all-time rate is used.
 */
export const JUDGE_RECENT_MIN_GRADES = 5

/**
 * Disagreement share the status sentence counts.
 * A last-14-days window that holds every grade, or fewer than
 * JUDGE_RECENT_MIN_GRADES grades, is the all-time rate. Calling a thin or
 * complete window "recent" showed 76/144 (53%), or 0% when the window was
 * empty, while the subtitle counted every grade (64c2b3df). A window that
 * is actually narrower, and thick enough, stays "in the last N days".
 */
export function judgeDisagreementWindow(stats: JudgeStats): {
  disagreed: number
  graded: number
  ratePct: number | null
  /** True only when the recent window is a narrower slice than all grades. */
  recent: boolean
  words: string
} {
  const days = stats.recentWindowDays ?? 14
  const recentGraded = stats.recentEvaluations
  const recentDisagreed = stats.recentDisagreements
  const coversAll =
    recentGraded != null && stats.totalEvaluations > 0 && recentGraded >= stats.totalEvaluations
  if (
    recentGraded != null &&
    recentDisagreed != null &&
    recentGraded >= JUDGE_RECENT_MIN_GRADES &&
    !coversAll
  ) {
    return {
      disagreed: recentDisagreed,
      graded: recentGraded,
      ratePct: recentGraded > 0 ? Math.round((recentDisagreed / recentGraded) * 100) : null,
      recent: true,
      words: `in the last ${days} days`,
    }
  }
  const graded = stats.totalEvaluations
  const disagreed = stats.disagreementCount
  return {
    disagreed,
    graded,
    ratePct: stats.disagreementRatePct ?? (graded > 0 ? Math.round((disagreed / graded) * 100) : null),
    recent: false,
    words: 'so far',
  }
}

/**
 * Grades tab label. A bare count beside "Grades" was read as how many grades
 * exist; it was the disagreement subset (76 vs 144 graded, 64c2b3df).
 */
export function judgeEvaluationsTab(
  label: string,
  stats: Pick<JudgeStats, 'disagreementCount' | 'totalEvaluations'>,
): { label: string; count?: number } {
  if (stats.disagreementCount > 0) {
    return { label: `${label} · ${stats.disagreementCount} disagree` }
  }
  return { label }
}
