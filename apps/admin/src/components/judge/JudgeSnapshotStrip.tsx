/**
 * FILE: JudgeSnapshotStrip.tsx
 * PURPOSE: Triage grading status: one sentence and the three numbers that say
 *          whether Mushi's diagnoses can be trusted (PageStatus, P1).
 */

import { Btn, PageStatus, type PageStatusMetric, type PageStatusTone } from '../ui'
import {
  judgeDisagreementHref,
  judgeDisagreementShare,
  judgeWeekTitle,
  type JudgeDisagreementShare,
  type JudgeStats,
} from './JudgeStatsTypes'
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

function disagreementLead(share: JudgeDisagreementShare): string {
  const p = share.windowPhrase
  return p.charAt(0).toUpperCase() + p.slice(1)
}

function disagreementMetricLabel(share: JudgeDisagreementShare, statLabels?: Record<string, string>): string {
  if (share.kind === 'all') return statLabels?.disagree ?? 'Disagreements, all time'
  return share.windowPhrase === 'this week' ? 'Disagreed this week' : `Disagreed ${share.windowPhrase}`
}

/** @internal Exported for tests only. */
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
  const w = judgeDisagreementShare(stats)
  const disagree =
    w.graded === 0
      ? `. Nothing was graded ${w.windowPhrase}.`
      : w.disagreed > 0
        ? `. ${disagreementLead(w)} the grader disagreed with ${w.disagreed} of ${w.graded} diagnoses (${w.ratePct}%).`
        : `. The grader agreed with all ${w.graded} diagnoses ${w.windowPhrase}.`
  return scored + disagree
}

export function JudgeSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, onSeeDisagreements }: Props) {
  const w = judgeDisagreementShare(stats)
  const disagreements: PageStatusMetric = {
    label: disagreementMetricLabel(w, statLabels),
    value: w.disagreed,
    tone: w.disagreed > 0 ? 'warn' : 'neutral',
    hint: 'Grades where the second model disagreed with the diagnosis. Read these before merging their fixes.',
    to: judgeDisagreementHref(stats),
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
