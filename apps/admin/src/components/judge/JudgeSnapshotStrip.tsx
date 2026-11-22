/**
 * FILE: JudgeSnapshotStrip.tsx
 * PURPOSE: Triage grading status: what is wrong ("7 of 12 diagnoses disagreed with the
 *          grader"), the one button that fixes it ("Review 7"), and three numbers: agreement as a
 *          bar against the 80% target, disagreements still to review, reports ready to grade.
 */

import { Btn, PageStatus, type PageStatusMetric } from '../ui'
import { ThresholdBar } from '../signal/BarCell'
import { AGREEMENT_TARGET_PCT, judgeLead } from '../../lib/judgeReview'
import type { JudgeStats } from './JudgeStatsTypes'
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

/**
 * @internal Exported for tests only. The lead sentence: how many diagnoses the grader disagreed
 * with, then what to do (lib/judgeReview.ts holds the rule; this keeps the old export name).
 */
export function judgeStatusSentence(stats: JudgeStats): string {
  return judgeLead(stats).sentence
}

export function JudgeSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, onSeeDisagreements, showSentence = true }: Props) {
  const lead = judgeLead(stats)
  const recent = stats.recentEvaluations != null && stats.recentDisagreements != null
  const days = stats.recentWindowDays ?? 14
  const agreement: PageStatusMetric = {
    label: recent ? `Agreed · ${days}d` : 'Agreed, all time',
    value: lead.agreementPct != null ? `${lead.agreementPct}%` : '—',
    tone: lead.agreementPct == null ? 'neutral' : lead.agreementPct >= AGREEMENT_TARGET_PCT ? 'ok' : lead.agreementPct >= 60 ? 'warn' : 'danger',
    hint: `How often the grader agreed with the diagnosis. The tick is the ${AGREEMENT_TARGET_PCT}% target.`,
    to: judgeLinks.disagree,
    visual:
      lead.agreementPct != null ? (
        <ThresholdBar
          fill={lead.agreementPct / 100}
          warn={AGREEMENT_TARGET_PCT / 100}
          crit={null}
          level={lead.agreementPct >= AGREEMENT_TARGET_PCT ? 'ok' : lead.agreementPct >= 60 ? 'warn' : 'crit'}
          label={`${lead.graded - lead.disagreed}/${lead.graded}`}
        />
      ) : undefined,
  }
  const disagreements: PageStatusMetric = {
    label: lead.toReview > 0 && lead.toReview < lead.disagreed ? `To review · ${days}d` : recent ? `Disagreed · ${days}d` : (statLabels?.disagree ?? 'Disagreements, all time'),
    value: lead.toReview > 0 && lead.toReview < lead.disagreed ? lead.toReview : lead.disagreed,
    tone: lead.toReview > 0 ? 'warn' : 'neutral',
    hint: 'Grades where the second model disagreed with the diagnosis. Review these before merging their fixes.',
    to: judgeLinks.disagree,
  }
  return (
    <PageStatus
      ariaLabel="Triage grading status"
      tone={lead.tone}
      marked={!showSentence}
      sentence={showSentence ? lead.sentence : null}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      action={
        onSeeDisagreements && lead.toReview > 0 ? (
          <Btn size="sm" variant="primary" onClick={onSeeDisagreements} data-testid="judge-review-action">
            Review {lead.toReview}
          </Btn>
        ) : undefined
      }
      metrics={[
        agreement,
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
