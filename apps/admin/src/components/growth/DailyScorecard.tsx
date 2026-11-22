/**
 * FILE: apps/admin/src/components/growth/DailyScorecard.tsx
 * PURPOSE: The Growth page's daily scorecard (November GTM plan §6.1):
 *          cookieless landing page views, builder signups and activated
 *          organizations per UTC day, and the same by `?src=` / signup source.
 *
 * Data: GET /v1/admin/growth/daily?days=14 (operator-only, gtm_daily_scorecard).
 * Page views are counts, not people: the docs site sends no id, so one person
 * reading three pages is three views. Activated = an organization's first
 * real end-user report from a deployed app that got a diagnosis.
 */

import { usePageData } from '../../lib/usePageData'
import { rate, scorecardTotals, sortedSources, type DailyScorecard as Scorecard } from '../../lib/dailyScorecard'
import { Btn, Section } from '../ui'
import { PageLoadError } from '../PageLoadError'
import { BarSparkline } from '../charts'
import { shortDay } from '../../lib/growthView'

const DAYS = 14

export function DailyScorecard() {
  const { data, loading, error, errorCode, requestId, errorEndpoint, reload } = usePageData<Scorecard>(
    `/v1/admin/growth/daily?days=${DAYS}`,
    { scope: 'none' },
  )

  // A read past the 15 s GET limit is "not checked", one line with a retry,
  // not an error panel or an endless "Loading…" (round-2 sweep 2026-11-18).
  if (error && errorCode === 'TIMEOUT') {
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted" data-testid="scorecard-not-checked">
        <span aria-hidden className="ci-nodata inline-block h-3 w-6 shrink-0 rounded-sm border border-edge-subtle" />
        Daily scorecard not checked: the read took too long.
        <Btn size="sm" variant="ghost" onClick={reload}>
          Try again
        </Btn>
      </p>
    )
  }
  if (error) {
    return (
      <PageLoadError
        error={error}
        code={errorCode}
        resource="daily scorecard"
        endpoint={errorEndpoint}
        requestId={requestId}
        onRetry={reload}
      />
    )
  }
  if (loading && !data) {
    return <div className="py-6 text-center text-sm text-fg-faint">Loading the daily scorecard…</div>
  }
  if (!data) return null

  const days = data.days
  const totals = scorecardTotals(days)
  const sources = sortedSources(data.by_src)
  // A column of 0 in both tables says nothing: Activated shows once it has a
  // value (round-3 sweep 2026-11-19); the figure above still says 0.
  const showActivated = totals.activated > 0 || sources.some((s) => s.activated > 0)

  return (
    <Section title={`Daily scorecard — last ${days.length} days (UTC)`}>
      {/* Figures on the section itself: stat cards inside this card were a card in a card (round-2 sweep 2026-11-18). */}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="scorecard-totals">
        <Figure label="Page views" value={totals.page_views} detail="landing + docs, no cookies" trend={days.map((d) => d.page_views)} />
        <Figure label="Signups" value={totals.signups} detail={`${rate(totals.signups, totals.page_views)} of page views`} trend={days.map((d) => d.signups)} />
        <Figure label="Activated" value={totals.activated} detail={`${rate(totals.activated, totals.signups)} of signups`} trend={days.map((d) => d.activated)} />
      </dl>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-2xs text-fg-secondary font-semibold">
                <th className="py-1.5 pr-3 font-medium">Day</th>
                <th className="py-1.5 px-2 text-right font-medium">Page views</th>
                <th className="py-1.5 px-2 text-right font-medium">Signups</th>
                {showActivated && <th className="py-1.5 px-2 text-right font-medium">Activated</th>}
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day} className="border-t border-edge-subtle">
                  <td className="py-1.5 pr-3 text-fg-muted whitespace-nowrap">{shortDay(d.day)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-fg">{d.page_views}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-fg">{d.signups}</td>
                  {showActivated && <td className="py-1.5 px-2 text-right tabular-nums text-fg">{d.activated}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto">
          {sources.length === 0 ? (
            <p className="text-xs text-fg-faint">No page views or signups in this window yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-2xs text-fg-secondary font-semibold">
                  <th className="py-1.5 pr-3 font-medium">Source (?src=)</th>
                  <th className="py-1.5 px-2 text-right font-medium">Page views</th>
                  <th className="py-1.5 px-2 text-right font-medium">Signups</th>
                  {showActivated && <th className="py-1.5 px-2 text-right font-medium">Activated</th>}
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.src} className="border-t border-edge-subtle">
                    <td className="py-1.5 pr-3 text-fg">{s.src}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-fg">{s.page_views}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-fg">{s.signups}</td>
                    {showActivated && <td className="py-1.5 px-2 text-right tabular-nums text-fg">{s.activated}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <p
        className="mt-2 text-2xs text-fg-faint"
        title="Page views keep no visitor id, so one person reading three pages counts three. Activated = an organization's first real user report from a deployed app (not a dev server) that got a diagnosis. A signup's source is its “How did you hear” answer, else the ?src= it arrived with."
      >
        Page views are counts, not people. Activated = first real user report with a diagnosis.
      </p>
    </Section>
  )
}

function Figure({ label, value, detail, trend }: { label: string; value: number; detail: string; trend: number[] }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-semibold text-fg-secondary">{label}</dt>
      <dd className="flex items-end justify-between gap-2">
        <span className="text-xl font-semibold tabular-nums text-fg">{value}</span>
        {trend.some((v) => v > 0) && (
          <span className="w-20 shrink-0 text-fg-muted">
            <BarSparkline values={trend} height={20} ariaLabel={`${label} per day`} />
          </span>
        )}
      </dd>
      <dd className="text-2xs text-fg-muted">{detail}</dd>
    </div>
  )
}
