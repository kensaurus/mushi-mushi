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
 * Which disagreement share the /judge status shows.
 * The latest week with grades wins: a 14-day window that contains every
 * grade is the all-time rate, and the page was labeling that "recent"
 * (64c2b3df). `windowPhrase` is written to follow "disagreed" / "grades".
 */
export interface JudgeDisagreementShare {
  kind: 'week' | 'recent' | 'all'
  disagreed: number
  graded: number
  ratePct: number | null
  windowPhrase: string
  weekStart: string | null
}

function mondayUtc(now: Date): string {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return monday.toISOString().slice(0, 10)
}

function weekWindowPhrase(weekStart: string, now: Date): string {
  const day = weekStart.slice(0, 10)
  if (day === mondayUtc(now)) return 'this week'
  const d = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(d.getTime())) return 'this week'
  const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `in the week of ${formatted}`
}

/** Latest week on the chart, else the 14-day window, else all-time. The phrase names which. */
export function judgeDisagreementShare(stats: JudgeStats, now = new Date()): JudgeDisagreementShare {
  const weeks = stats.agreementWeeks ?? []
  let latest: { weekStart: string; graded: number; agreed: number } | null = null
  for (const w of weeks) {
    if (w.graded <= 0) continue
    if (!latest || w.weekStart > latest.weekStart) latest = w
  }
  if (latest) {
    const disagreed = Math.max(0, latest.graded - latest.agreed)
    return {
      kind: 'week',
      disagreed,
      graded: latest.graded,
      ratePct: Math.round((disagreed / latest.graded) * 100),
      windowPhrase: weekWindowPhrase(latest.weekStart, now),
      weekStart: latest.weekStart.slice(0, 10),
    }
  }
  if (stats.recentEvaluations != null && stats.recentDisagreements != null) {
    const days = stats.recentWindowDays ?? 14
    const graded = stats.recentEvaluations
    const disagreed = stats.recentDisagreements
    return {
      kind: 'recent',
      disagreed,
      graded,
      ratePct: graded > 0 ? Math.round((disagreed / graded) * 100) : null,
      windowPhrase: `in the last ${days} days`,
      weekStart: null,
    }
  }
  const graded = stats.totalEvaluations
  const disagreed = stats.disagreementCount
  return {
    kind: 'all',
    disagreed,
    graded,
    ratePct: stats.disagreementRatePct ?? (graded > 0 ? Math.round((disagreed / graded) * 100) : null),
    windowPhrase: 'so far',
    weekStart: null,
  }
}

/** Evaluations list for the share above. A week link is bounded to that week. */
export function judgeDisagreementHref(stats: JudgeStats, now = new Date()): string {
  const params = new URLSearchParams({ tab: 'evaluations', filter: 'disagreement' })
  const share = judgeDisagreementShare(stats, now)
  if (share.kind === 'week' && share.weekStart) {
    const start = Date.parse(`${share.weekStart}T00:00:00.000Z`)
    if (Number.isFinite(start)) {
      params.set('from', new Date(start).toISOString())
      params.set('to', new Date(start + 7 * 86_400_000 - 1).toISOString())
    }
  }
  return `/judge?${params.toString()}`
}
