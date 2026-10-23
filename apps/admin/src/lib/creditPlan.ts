/**
 * FILE: apps/admin/src/lib/creditPlan.ts
 * PURPOSE: The arithmetic behind /credits ("Spend credits"): how many days a
 *          key's credits have left, and how much of a Firecrawl balance the
 *          site watches will use before it resets, so the page can say what
 *          would go unused. Pure, so the page and its tests share it.
 */

const DAY_MS = 86_400_000

/** Whole days from `now` until `until` (rounded up); null when unknown, 0 once past. */
function daysLeft(until: string | null | undefined, now: Date): number | null {
  if (!until) return null
  const t = Date.parse(until)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS))
}

export interface WatchCost {
  status: string
  page_limit: number
  /** Firecrawl's own estimate for the monitor; null before it gave one. */
  estimated_credits_per_month: number | null
}

/**
 * Credits a day across the active watches. Firecrawl's estimate when it gave
 * one, else the upper bound the watch card quotes (2 credits a page a day).
 */
function watchCreditsPerDay(watches: WatchCost[]): number {
  return watches
    .filter((w) => w.status === 'active')
    .reduce((sum, w) => sum + (w.estimated_credits_per_month ?? w.page_limit * 60) / 30, 0)
}

export interface AuditCost {
  enabled: boolean
  page_limit: number
  cadence_days: number
  /** Credits the last run used (Firecrawl's count), when known. */
  last_summary?: { credits?: number | null; pages?: number } | null
}

/**
 * Credits a day across enabled site audits (ADR 0040): one credit a page per
 * run plus the map call, spread over the cadence. The last run's real count
 * when there is one, else the page limit.
 */
function auditCreditsPerDay(audits: AuditCost[]): number {
  return audits
    .filter((a) => a.enabled)
    .reduce((sum, a) => sum + ((a.last_summary?.credits ?? a.page_limit) + 1) / Math.max(1, a.cadence_days), 0)
}

/** A search rank check reads 20 results (2 credits per 10) per keyword, weekly. */
const RANK_CREDITS_PER_KEYWORD_WEEK = 4

export interface FirecrawlPace {
  perDay: number
  days: number | null
  /** What the watches will use before the reset; null when the reset date is unknown. */
  projected: number | null
  /** Credits left over at the reset at this pace; null when unknown. */
  unused: number | null
}

export function firecrawlPace(input: {
  remaining: number | null
  periodEnd: string | null
  watches: WatchCost[]
  audits?: AuditCost[]
  rankKeywords?: number
  now: Date
}): FirecrawlPace {
  const perDay =
    watchCreditsPerDay(input.watches) + auditCreditsPerDay(input.audits ?? []) + ((input.rankKeywords ?? 0) * RANK_CREDITS_PER_KEYWORD_WEEK) / 7
  const days = daysLeft(input.periodEnd, input.now)
  const projected = days == null ? null : Math.round(perDay * days)
  const unused = projected == null || input.remaining == null ? null : Math.max(0, input.remaining - projected)
  return { perDay, days, projected, unused }
}

/** "about 1,000 a day · about 11,000 before Nov 3 · about 53,000 would go unused" */
export function paceLine(pace: FirecrawlPace, periodEnd: string | null): string {
  const n = (v: number) => Math.round(v).toLocaleString()
  if (pace.perDay === 0) return 'Nothing is watched, audited or rank-checked, so nothing is spent.'
  const parts = [`Watches, audits and rank checks use about ${n(pace.perDay)} a day`]
  if (pace.projected != null && periodEnd) parts.push(`about ${n(pace.projected)} before ${shortDate(periodEnd)}`)
  if (pace.unused != null) parts.push(pace.unused > 0 ? `about ${n(pace.unused)} would go unused` : 'the balance runs out first')
  return `${parts.join(' · ')}.`
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** "expires Oct 28 (5 days)", "expired", or null without a date. */
export function expiryLabel(until: string | null | undefined, now: Date, verb = 'expires'): string | null {
  const days = daysLeft(until, now)
  if (days == null || !until) return null
  if (days === 0) return verb === 'expires' ? 'expired' : `${verb} today`
  return `${verb} ${shortDate(until)} (${days} day${days === 1 ? '' : 's'})`
}
