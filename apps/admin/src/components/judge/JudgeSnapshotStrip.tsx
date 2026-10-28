/**
 * FILE: JudgeSnapshotStrip.tsx
 * PURPOSE: Triage grading status: one sentence and the three numbers that say
 *          whether Mushi's diagnoses can be trusted (PageStatus, P1).
 */

import { Btn, PageStatus, type PageStatusMetric, type PageStatusTone } from '../ui'
import { judgeDisagreementWindow, judgeWeekTitle, type JudgeStats } from './JudgeStatsTypes'
import { judgeLinks } from '../../lib/statCardLinks'

interface Props {
  stats: JudgeStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** Opens the disagreements list: the page's one action while any exist. */
  onSeeDisagreements?: () => void
}

function scoreTone(score: number | null): PageStatusTone {
  if (score == null) return 'neutral'
  if (score >= 0.8) return 'ok'
  if (score >= 0.6) return 'warn'
  return 'danger'
}

/** @internal Exported for tests only. Names the 14-day slice only when it is narrower than all grades (64c2b3df). */
export function judgeStatusSentence(stats: JudgeStats): string {
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
  const w = judgeDisagreementWindow(stats)
  const disagree =
    w.graded === 0
      ? `. Nothing was graded ${w.words}.`
      : w.disagreed > 0
        ? `. ${w.recent ? 'In the last' : 'So far'}${w.recent ? ` ${stats.recentWindowDays ?? 14} days` : ''} the grader disagreed with ${w.disagreed} of ${w.graded} diagnoses (${w.ratePct ?? 0}%).`
        : `. The grader agreed with all ${w.graded} diagnoses ${w.words}.`
  return scored + disagree
}

export function JudgeSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, onSeeDisagreements }: Props) {
  const w = judgeDisagreementWindow(stats)
  const disagreements: PageStatusMetric = {
    label: w.recent ? `Disagreed, last ${stats.recentWindowDays ?? 14} days` : (statLabels?.disagree ?? 'Disagreements, all time'),
    value: w.disagreed,
    tone: w.disagreed > 0 ? 'warn' : 'neutral',
    hint: 'Grades where the second model disagreed with the diagnosis. Read these before merging their fixes.',
    to: judgeLinks.disagree,
  }
  return (
    <PageStatus
      ariaLabel="Triage grading status"
      tone={scoreTone(stats.latestWeekScore)}
      sentence={judgeStatusSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      action={
        onSeeDisagreements && w.disagreed > 0 ? (
          <Btn size="sm" variant="primary" onClick={onSeeDisagreements}>
            See disagreements
          </Btn>
        ) : undefined
      }
      metrics={[
        {
          label: statLabels?.week ?? judgeWeekTitle(stats.latestWeekLabel),
          value: stats.latestWeekScore != null ? `${Math.round(stats.latestWeekScore * 100)}%` : '—',
          tone: scoreTone(stats.latestWeekScore),
          hint: 'Average grade for the latest week with grades: was the category, severity and component right.',
          to: judgeLinks.week,
        },
        disagreements,
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
