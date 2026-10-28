/**
 * FILE: apps/admin/src/lib/dailyScorecard.ts
 * PURPOSE: Shapes and helpers for the Growth page's daily scorecard
 *          (GET /v1/admin/growth/daily, November GTM plan §6.1): cookieless
 *          landing page views, builder signups and activated organizations
 *          per UTC day and by `?src=` / signup source.
 */

export interface ScorecardDay {
  /** UTC day, YYYY-MM-DD. */
  day: string
  page_views: number
  signups: number
  activated: number
}

export interface ScorecardSource {
  /** `?src=` tag of the page views; the owner's signup source for signups and activations. */
  src: string
  page_views: number
  signups: number
  activated: number
}

export interface DailyScorecard {
  days: ScorecardDay[]
  by_src: ScorecardSource[]
  window_start: string | null
  self_project_configured: boolean
  generated_at: string
}

export function scorecardTotals(days: readonly ScorecardDay[]): Pick<ScorecardDay, 'page_views' | 'signups' | 'activated'> {
  return days.reduce(
    (acc, d) => ({
      page_views: acc.page_views + (d.page_views ?? 0),
      signups: acc.signups + (d.signups ?? 0),
      activated: acc.activated + (d.activated ?? 0),
    }),
    { page_views: 0, signups: 0, activated: 0 },
  )
}

/** `part / whole` as a percentage (one decimal under 10%), or an em dash when the base is zero. */
export function rate(part: number, whole: number): string {
  if (whole <= 0) return '—'
  const pct = (part / whole) * 100
  return pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`
}

/** Sources by page views, then signups; 'unknown' (no tag) last. */
export function sortedSources(rows: readonly ScorecardSource[]): ScorecardSource[] {
  return [...rows].sort((a, b) => {
    if ((a.src === 'unknown') !== (b.src === 'unknown')) return a.src === 'unknown' ? 1 : -1
    return b.page_views - a.page_views || b.signups - a.signups || a.src.localeCompare(b.src)
  })
}
