/**
 * FILE: apps/admin/src/components/judge/JudgeAgreementOverview.tsx
 * PURPOSE: "Can I trust Mushi's diagnoses?" in two pictures (console
 *          journeys 2026-10-27):
 *            1. how often the grader agreed with the diagnosis, week by week;
 *            2. the 3 worst disagreements of the last 14 days, each with the
 *               grader's reason and a link to the report.
 *
 * Data: `agreementWeeks` from GET /v1/admin/judge/stats, and
 *       GET /v1/admin/judge/evaluations?disagreement=1&sort=score_asc&limit=3&from&to
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading, Section } from '../ui'
import { MetricTimeline } from '../charts/MetricTimeline'
import { usePageData } from '../../lib/usePageData'
import { judgeEvaluationsPath } from '../../lib/judgeFilters'
import { LINK_ACCENT } from '../../lib/chipTone'

interface AgreementWeek {
  weekStart: string
  graded: number
  agreed: number
}

interface Disagreement {
  id: string
  report_id: string
  judge_score: number | null
  judge_reasoning: string | null
  report_summary: string | null
  created_at: string
}

/** @internal Exported for tests only. Weekly agreement as a percentage; weeks with no grades are skipped. */
export function agreementPoints(weeks: readonly AgreementWeek[]): Array<{ ts: string; value: number }> {
  return weeks
    .filter((w) => w.graded > 0)
    .map((w) => ({ ts: `${w.weekStart}T00:00:00Z`, value: Math.round((w.agreed / w.graded) * 100) }))
}

/** "week of Nov 9 (2 grades)" for the one graded week. */
function singleWeekWords(weeks: readonly AgreementWeek[]): string {
  const w = weeks.find((x) => x.graded > 0)
  if (!w) return ''
  const day = new Date(`${w.weekStart}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `week of ${day} (${w.agreed} of ${w.graded} grade${w.graded === 1 ? '' : 's'})`
}

function firstSentence(text: string | null): string | null {
  if (!text) return null
  const t = text.trim()
  const m = /^(.{20,280}?[.!?])(\s|$)/.exec(t)
  return m ? m[1]! : t.length > 280 ? `${t.slice(0, 277)}…` : t
}

export function JudgeAgreementOverview({
  weeks,
  windowDays,
  capped,
}: {
  weeks: readonly AgreementWeek[]
  windowDays: number
  /** The server read its row cap, so the oldest week may be partial. */
  capped?: boolean
}) {
  // Fixed once per mount: a moving `from` would change the path every render.
  const [range] = useState(() => {
    const now = Date.now()
    return { from: new Date(now - windowDays * 86_400_000).toISOString(), to: new Date(now).toISOString() }
  })
  const worst = usePageData<{ evaluations: Disagreement[] }>(
    judgeEvaluationsPath({ sort: 'score_asc', page: 1, pageSize: 3, disagreementOnly: true, prompt: null, from: range.from, to: range.to }),
  )
  const points = agreementPoints(weeks)
  const rows = worst.data?.evaluations ?? []

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-2 [&>*]:min-w-0" data-testid="judge-agreement-overview">
      <Section title="How often the grader agrees">
        {points.length === 1 ? (
          // One week can't draw a trend: its axis ran "0%" to "0%" and
          // "Nov 9" to "Nov 9" (2026-11-18 sweep). Say the one value instead.
          <div className="space-y-1" data-testid="judge-agreement-single">
            <p className="text-sm text-fg">
              <span className="font-semibold tabular-nums">{points[0]!.value}%</span>{' '}
              <span className="text-fg-secondary">agreed, {singleWeekWords(weeks)}</span>
            </p>
            <p className="text-2xs text-fg-faint">The trend shows after 2 weeks of grades.</p>
          </div>
        ) : points.length > 0 ? (
          <>
            <MetricTimeline title="Agreed with the diagnosis, per week (%)" points={points} formatValue={(v) => `${Math.round(v)}%`} height={120} />
            {capped ? <p className="mt-1 text-2xs text-fg-faint">The oldest week may be missing some grades.</p> : null}
          </>
        ) : (
          <p className="text-xs text-fg-muted">No grades in the last 12 weeks.</p>
        )}
      </Section>
      <Section title={`Worst disagreements, last ${windowDays} days`}>
        {worst.loading && !worst.data ? (
          <Loading text="Reading the disagreements…" />
        ) : rows.length === 0 ? (
          <p className="text-xs text-fg-muted">No disagreements in the last {windowDays} days.</p>
        ) : (
          <ol className="list-none space-y-2 p-0" data-testid="judge-worst-disagreements">
            {rows.map((r) => (
              <li key={r.id} className="min-w-0 rounded-sm border border-edge-subtle px-2.5 py-2">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <Link to={`/reports/${r.report_id}`} className={`min-w-0 truncate text-xs font-medium ${LINK_ACCENT}`}>
                    {r.report_summary ?? 'Untitled report'}
                  </Link>
                  {r.judge_score != null ? (
                    // Labelled, and not red: a disagreement can still earn a high
                    // grade (87%), so the number alone isn't a failure.
                    <span className="shrink-0 whitespace-nowrap text-2xs tabular-nums text-fg-secondary">
                      grade {Math.round(r.judge_score * 100)}%
                    </span>
                  ) : null}
                </div>
                {firstSentence(r.judge_reasoning) ? (
                  <p className="mt-0.5 text-2xs leading-snug text-fg-secondary">{firstSentence(r.judge_reasoning)}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}
