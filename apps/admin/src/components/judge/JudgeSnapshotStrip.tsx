/**
 * FILE: JudgeSnapshotStrip.tsx
 * PURPOSE: Triage grading status: one sentence and the three numbers that say
 *          whether Mushi's diagnoses can be trusted (PageStatus, P1).
 */

import { PageStatus, type PageStatusTone } from '../ui'
import { judgeWeekTitle, type JudgeStats } from './JudgeStatsTypes'
import { judgeLinks } from '../../lib/statCardLinks'

interface Props {
  stats: JudgeStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
}

function scoreTone(score: number | null): PageStatusTone {
  if (score == null) return 'neutral'
  if (score >= 0.8) return 'ok'
  if (score >= 0.6) return 'warn'
  return 'danger'
}

function judgeStatusSentence(stats: JudgeStats): string {
  if (stats.totalEvaluations === 0) {
    return stats.ungradedReports > 0
      ? `Nothing graded yet; ${stats.ungradedReports} diagnosed report${stats.ungradedReports === 1 ? ' is' : 's are'} ready.`
      : 'Nothing graded yet. Grades start once reports are diagnosed.'
  }
  const week = judgeWeekTitle(stats.latestWeekLabel).toLowerCase()
  const score = stats.latestWeekScore != null ? `${Math.round(stats.latestWeekScore * 100)}%` : null
  const scored = score
    ? `Diagnoses scored ${score} ${week} across ${stats.latestWeekEvalCount} grade${stats.latestWeekEvalCount === 1 ? '' : 's'}`
    : `No grades ${week}`
  const disagree =
    stats.disagreementCount > 0
      ? `; the grader disagreed with ${stats.disagreementCount}${stats.disagreementRatePct != null ? ` (${stats.disagreementRatePct}%)` : ''}.`
      : '; no disagreements.'
  return scored + disagree
}

export function JudgeSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Triage grading status"
      tone={scoreTone(stats.latestWeekScore)}
      sentence={judgeStatusSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.week ?? judgeWeekTitle(stats.latestWeekLabel),
          value: stats.latestWeekScore != null ? `${Math.round(stats.latestWeekScore * 100)}%` : '—',
          tone: scoreTone(stats.latestWeekScore),
          hint: 'Average grade for the latest week with grades: was the category, severity and component right.',
          to: judgeLinks.week,
        },
        {
          label: statLabels?.disagree ?? 'Disagreements',
          value: stats.disagreementCount,
          tone: stats.disagreementCount > 0 ? 'warn' : 'neutral',
          hint: 'Grades where the second model disagreed with the diagnosis. Read these before merging their fixes.',
          to: judgeLinks.disagree,
        },
        {
          label: statLabels?.classified ?? 'Ready to grade',
          value: stats.ungradedReports,
          hint: 'Diagnosed reports the grader has not scored yet.',
          to: judgeLinks.classified,
        },
      ]}
    />
  )
}
