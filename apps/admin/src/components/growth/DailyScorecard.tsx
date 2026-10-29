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
import { Section, StatCard, StatGrid } from '../ui'
import { PageLoadError } from '../PageLoadError'

const DAYS = 14

export function DailyScorecard() {
  const { data, loading, error, errorCode, requestId, errorEndpoint, reload } = usePageData<Scorecard>(
    `/v1/admin/growth/daily?days=${DAYS}`,
    { scope: 'none' },
  )

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

  return (
    <Section title={`Daily scorecard — last ${days.length} days (UTC)`}>
      <StatGrid>
        <StatCard
          label="Page views"
          value={String(totals.page_views)}
          detail="landing + docs, no cookies"
          trend={days.map((d) => d.page_views)}
        />
        <StatCard
          label="Signups"
          value={String(totals.signups)}
          detail={`${rate(totals.signups, totals.page_views)} of page views`}
          trend={days.map((d) => d.signups)}
        />
        <StatCard
          label="Activated"
          value={String(totals.activated)}
          detail={`${rate(totals.activated, totals.signups)} of signups`}
          trend={days.map((d) => d.activated)}
        />
      </StatGrid>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wider text-fg-faint">
                <th className="py-1.5 pr-3 font-medium">Day</th>
                <th className="py-1.5 px-2 text-right font-medium">Page views</th>
                <th className="py-1.5 px-2 text-right font-medium">Signups</th>
                <th className="py-1.5 px-2 text-right font-medium">Activated</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day} className="border-t border-edge-subtle">
                  <td className="py-1.5 pr-3 font-mono text-fg-muted whitespace-nowrap">{d.day}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-fg">{d.page_views}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-fg">{d.signups}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-fg">{d.activated}</td>
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
                <tr className="text-left text-2xs uppercase tracking-wider text-fg-faint">
                  <th className="py-1.5 pr-3 font-medium">Source (?src=)</th>
                  <th className="py-1.5 px-2 text-right font-medium">Page views</th>
                  <th className="py-1.5 px-2 text-right font-medium">Signups</th>
                  <th className="py-1.5 px-2 text-right font-medium">Activated</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.src} className="border-t border-edge-subtle">
                    <td className="py-1.5 pr-3 text-fg">{s.src}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-fg">{s.page_views}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-fg">{s.signups}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-fg">{s.activated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <p className="mt-2 text-2xs text-fg-faint">
        Page views are counts, not people: the site stores nothing, so one person reading three pages counts three.
        Activated = an organization&apos;s first real user report from a deployed app (not a dev server) that got a
        diagnosis. A signup&apos;s source is its &ldquo;How did you hear&rdquo; answer, else the ?src= it arrived with.
      </p>
    </Section>
  )
}
