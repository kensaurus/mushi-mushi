/**
 * The public scoreboard page (/proof): the API call and the pure helpers it
 * renders with. Server side: packages/server/supabase/functions/api/routes/
 * public-scoreboard.ts (aggregates only, cached 15 minutes).
 */

import { PUBLIC_API_URL } from './public-diagram'

export interface Scoreboard {
  days: number
  apps: number
  userReports: number
  reporters: number
  otherReports: number
  fixesMerged: number
  mergedFromUsers: number
  reviews: number
  reviewsHold: number
  medianHoursToMergedFix: number | null
  weeklyMerged: Array<{ weekStart: string; merged: number }>
  asOf: string
}

export async function loadScoreboard(fetchImpl: typeof fetch = fetch): Promise<Scoreboard | null> {
  try {
    const res = await fetchImpl(`${PUBLIC_API_URL}/v1/public/scoreboard`)
    const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: Scoreboard } | null
    return res.ok && body?.ok && body.data ? body.data : null
  } catch {
    return null
  }
}

const fmt = new Intl.NumberFormat('en-US')

/** A count, or a dash when the API sent none (an older cached answer): never "NaN". */
export function formatCount(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? fmt.format(n) : '–'
}

/** 26.4 → "26 hours"; under 2 → minutes; over 72 → days. */
export function formatHours(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return 'not enough data yet'
  if (h < 2) return `${Math.max(1, Math.round(h * 60))} minutes`
  if (h > 72) return `${(h / 24).toFixed(1)} days`
  return `${Math.round(h)} hours`
}

/** "Oct 28, 2026, 12:00 UTC" */
export function formatAsOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`
}

/**
 * Points of a sparkline in a `width` × `height` box (y grows down), one per
 * value, the tallest value touching the top. All zeros sit on the baseline.
 */
export function sparklinePoints(values: readonly number[], width: number, height: number): Array<{ x: number; y: number }> {
  if (values.length === 0) return []
  const max = Math.max(...values, 0)
  const step = values.length > 1 ? width / (values.length - 1) : 0
  return values.map((v, i) => ({
    x: Math.round(i * step * 10) / 10,
    y: Math.round((max > 0 ? height - (Math.max(0, v) / max) * height : height) * 10) / 10,
  }))
}

export function sparklinePath(points: ReadonlyArray<{ x: number; y: number }>): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
}
