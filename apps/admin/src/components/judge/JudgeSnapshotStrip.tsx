/**
 * FILE: JudgeSnapshotStrip.tsx
 * PURPOSE: Triage grading status: one sentence and the three numbers that say
 *          whether Mushi's diagnoses can be trusted (PageStatus, P1).
 */

import { Btn, PageStatus, type PageStatusMetric, type PageStatusTone } from '../ui'
import { judgeWeekTitle, type JudgeStats } from './JudgeStatsTypes'
import { judgeLinks } from '../../lib/statCardLinks'

interface Props {
  stats: JudgeStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** Opens the disagreements list: the page's one action while any exist. */
  onSeeDisagreements?: () => void
  /** The verdict sentence shows on Overview only; other tabs keep the numbers (2026-11-19). */
  showSentence?: boolean
}

function scoreTone(score: number | null): PageStatusTone {
  if (score == null) return 'neutral'
  if (score >= 0.8) return 'ok'
  if (score >= 0.6) return 'warn'
  return 'danger'
}

/** The recent window when the server sent it, else all time; the words say which (64c2b3df). */
function disagreementWindow(stats: JudgeStats): { disagreed: number; graded: number; words: string; recent: boolean } {
  if (stats.recentEvaluations != null && stats.recentDisagreements != null) {
    const days = stats.recentWindowDays ?? 14
    return { disagreed: stats.recentDisagreements, graded: stats.recentEvaluations, words: `in the last ${days} days`, recent: true }
  }
  return { disagreed: stats.disagreementCount, graded: stats.totalEvaluations, words: 'so far', recent: false }
}

/** "Week of Nov 9" → "week of Nov 9": only the first letter (the month kept its capital). */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/**
 * @internal Exported for tests only. Label of the latest-week number: what it is and which week,
 * short enough not to wrap to three lines at 390 (2026-11-19: "Average / grade, week / of Nov 9").
 */
export function judgeWeekMetricLabel(stats: Pick<JudgeStats, 'latestWeekLabel'>): string {
  const week = lowerFirst(judgeWeekTitle(stats.latestWeekLabel))
  const m = /^week of (.+)$/.exec(week)
  return `Avg grade · ${m ? m[1] : week}`
}

/**
 * @internal Exported for tests only.
 * The verdict the numbers below it don't say on their own (2026-11-18 sweep:
 * "scored 67%" beside "disagreed with 2 of 2 (100%)" read as a contradiction).
 * The average grade gives partial credit; a disagreement means the grader
 * would have diagnosed the report differently. The grade itself lives in the
 * labelled metric, so the sentence doesn't repeat it.
 */
export function judgeStatusSentence(stats: JudgeStats): string {
  if (stats.totalEvaluations === 0) {
    return stats.ungradedReports > 0
      ? `Nothing graded yet; ${stats.ungradedReports} diagnosed report${stats.ungradedReports === 1 ? ' is' : 's are'} ready.`
      : 'Nothing graded yet. Grades start once reports are diagnosed.'
  }
  const w = disagreementWindow(stats)
  if (w.graded === 0) return `Nothing was graded ${w.words}.`
  if (w.disagreed === 0) return `The grader agreed with all ${w.graded} diagnoses ${w.words}.`
  const when = w.recent ? `In the last ${stats.recentWindowDays ?? 14} days` : 'So far'
  const which = w.disagreed === w.graded ? 'every report it graded' : `${w.disagreed} of ${w.graded} reports`
  return `${when} the grader would have diagnosed ${which} differently. Read those before merging their fixes.`
}

export function JudgeSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, onSeeDisagreements, showSentence = true }: Props) {
  const w = disagreementWindow(stats)
  const disagreements: PageStatusMetric = {
    label: w.recent ? `Disagreed · ${stats.recentWindowDays ?? 14}d` : (statLabels?.disagree ?? 'Disagreements, all time'),
    value: w.disagreed,
    tone: w.disagreed > 0 ? 'warn' : 'neutral',
    hint: 'Grades where the second model disagreed with the diagnosis. Read these before merging their fixes.',
    to: judgeLinks.disagree,
  }
  return (
    <PageStatus
      ariaLabel="Triage grading status"
      tone={scoreTone(stats.latestWeekScore)}
      marked={!showSentence}
      sentence={showSentence ? judgeStatusSentence(stats) : null}
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
          // Not statLabels.week: that said "This week" over an older week's grade.
          label: judgeWeekMetricLabel(stats),
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
