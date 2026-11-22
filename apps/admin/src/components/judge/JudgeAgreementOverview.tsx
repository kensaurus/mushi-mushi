/**
 * FILE: apps/admin/src/components/judge/JudgeAgreementOverview.tsx
 * PURPOSE: "Can I trust Mushi Mushi's diagnoses?" in two pictures (console
 *          journeys 2026-10-27; review queue 2026-11-19):
 *            1. how often the grader agreed with the diagnosis, one bar per week against the
 *               80% target line (green at or over it, amber under, red under 60%);
 *            2. the worst disagreements of the last 14 days as review rows with their decision
 *               buttons (JudgeReviewRows).
 *
 * Data: `agreementWeeks` from GET /v1/admin/judge/stats, and
 *       GET /v1/admin/judge/evaluations?disagreement=1&sort=score_asc&limit=3&from&to
 */

import { useState } from 'react'
import { Loading, Section } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { judgeEvaluationsPath } from '../../lib/judgeFilters'
import { AGREEMENT_TARGET_PCT } from '../../lib/judgeReview'
import { STATUS_FILL, type RunStatus } from '../signal/StatusMark'
import { JudgeReviewRows, type ReviewRow } from './JudgeReviewRows'

interface AgreementWeek {
  weekStart: string
  graded: number
  agreed: number
}

/** @internal Exported for tests only. Weekly agreement as a percentage; weeks with no grades are skipped. */
export function agreementPoints(weeks: readonly AgreementWeek[]): Array<{ ts: string; value: number }> {
  return weeks
    .filter((w) => w.graded > 0)
    .map((w) => ({ ts: `${w.weekStart}T00:00:00Z`, value: Math.round((w.agreed / w.graded) * 100) }))
}

/** @internal Exported for tests only. A week's bar colour against the target. */
export function agreementStatus(pct: number): RunStatus {
  if (pct >= AGREEMENT_TARGET_PCT) return 'passed'
  if (pct >= 60) return 'slow'
  return 'failed'
}

/** "2026-11-09" → "Nov 9". */
function shortWeek(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function AgreementBars({ weeks }: { weeks: readonly AgreementWeek[] }) {
  const graded = weeks.filter((w) => w.graded > 0)
  return (
    <figure className="m-0" data-testid="judge-agreement-bars">
      <div className="relative flex h-24 items-end gap-1 border-b border-edge" role="list" aria-label={`Agreement per week, target ${AGREEMENT_TARGET_PCT}%`}>
        <span
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-fg-secondary"
          style={{ bottom: `${AGREEMENT_TARGET_PCT}%` }}
          aria-hidden="true"
          data-testid="judge-agreement-target"
        />
        <span className="pointer-events-none absolute right-0 -translate-y-full text-3xs font-semibold text-fg-secondary" style={{ bottom: `${AGREEMENT_TARGET_PCT}%` }} aria-hidden="true">
          target {AGREEMENT_TARGET_PCT}%
        </span>
        {graded.map((w) => {
          const pct = Math.round((w.agreed / w.graded) * 100)
          const status = agreementStatus(pct)
          return (
            <span
              key={w.weekStart}
              role="listitem"
              className="relative flex h-full min-w-0 flex-1 items-end"
              title={`Week of ${shortWeek(w.weekStart)}: ${pct}% agreed (${w.agreed} of ${w.graded})`}
              aria-label={`Week of ${shortWeek(w.weekStart)}: ${pct}% agreed, ${w.agreed} of ${w.graded}`}
              data-status={status}
            >
              <span className={`ci-rise w-full rounded-t-xs ${STATUS_FILL[status]}`} style={{ height: `${Math.max(2, pct)}%` }} />
            </span>
          )
        })}
      </div>
      <figcaption className="mt-1 flex justify-between text-3xs text-fg-muted tabular-nums">
        <span>{graded[0] ? shortWeek(graded[0].weekStart) : ''}</span>
        <span>{graded.length > 1 ? shortWeek(graded[graded.length - 1]!.weekStart) : ''}</span>
      </figcaption>
    </figure>
  )
}

export function JudgeAgreementOverview({
  weeks,
  windowDays,
  capped,
  canEdit = false,
  onChanged = () => {},
}: {
  weeks: readonly AgreementWeek[]
  windowDays: number
  /** The server read its row cap, so the oldest week may be partial. */
  capped?: boolean
  canEdit?: boolean
  /** A row was decided: reload the counts. */
  onChanged?: () => void
}) {
  // Fixed once per mount: a moving `from` would change the path every render.
  const [range] = useState(() => {
    const now = Date.now()
    return { from: new Date(now - windowDays * 86_400_000).toISOString(), to: new Date(now).toISOString() }
  })
  const worst = usePageData<{ evaluations: ReviewRow[] }>(
    judgeEvaluationsPath({ sort: 'score_asc', page: 1, pageSize: 3, disagreementOnly: true, prompt: null, from: range.from, to: range.to }),
  )
  const points = agreementPoints(weeks)
  const rows = worst.data?.evaluations ?? []
  // One graded week is the status line's number already: no chart until there are two.
  const single = points.length === 1

  return (
    <div className={`grid min-w-0 gap-3 [&>*]:min-w-0 ${single ? '' : 'lg:grid-cols-2'}`} data-testid="judge-agreement-overview">
      {single ? null : (
        <Section title="How often the grader agrees">
          {points.length > 0 ? (
            <>
              <AgreementBars weeks={weeks} />
              {capped ? <p className="mt-1 text-2xs text-fg-faint">The oldest week may be missing some grades.</p> : null}
            </>
          ) : (
            <p className="text-xs text-fg-muted">No grades in the last 12 weeks.</p>
          )}
        </Section>
      )}
      <Section title={`Worst disagreements, last ${windowDays} days`}>
        {worst.loading && !worst.data ? (
          <Loading text="Reading the disagreements…" />
        ) : rows.length === 0 ? (
          <p className="text-xs text-fg-muted">No disagreements in the last {windowDays} days.</p>
        ) : (
          <JudgeReviewRows
            rows={rows}
            canEdit={canEdit}
            onChanged={() => {
              worst.reload()
              onChanged()
            }}
            data-testid="judge-worst-disagreements"
          />
        )}
      </Section>
    </div>
  )
}
