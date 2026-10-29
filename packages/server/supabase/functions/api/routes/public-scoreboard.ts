/**
 * FILE: packages/server/supabase/functions/api/routes/public-scoreboard.ts
 * PURPOSE: GET /v1/public/scoreboard (served by api-ext) for the docs /proof
 *          page: the founder's own apps (organizations with
 *          billing_mode = 'complimentary'), last 60 days, aggregates only.
 *
 *          The numbers come from the SQL function `public_scoreboard` (service
 *          role only): bug reports users sent through the widget and how many
 *          people sent them, fixes merged, AI reviews completed and how many
 *          said hold ("do not merge"), the median hours from report to merged
 *          fix, and merged fixes per week. Only those keys are passed on
 *          (`toPublicScoreboard`), so a column added to the function later
 *          cannot leak. Cached 15 minutes per isolate and in the browser/CDN.
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'

export const SCOREBOARD_DAYS = 60
export const SCOREBOARD_TTL_MS = 15 * 60_000

export interface PublicScoreboard {
  days: number
  apps: number
  /** In-app reports from people on real devices (the owner's own testing included). */
  userReports: number
  reporters: number
  /** Every other report: console/API filings, AI audits and sweeps, imports, Sentry, site checks. */
  otherReports: number
  /** Every merged fix PR, whatever found the bug. */
  fixesMerged: number
  /** Merged fixes whose report came from a person (userReports). */
  mergedFromUsers: number
  reviews: number
  reviewsHold: number
  medianHoursToMergedFix: number | null
  weeklyMerged: Array<{ weekStart: string; merged: number }>
  asOf: string
}

function count(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0
}

/** The function's JSON → the public shape, whitelisted key by key. */
export function toPublicScoreboard(raw: unknown, asOf: Date): PublicScoreboard {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const median = typeof r.median_hours_to_merged_fix === 'number' ? r.median_hours_to_merged_fix : Number(r.median_hours_to_merged_fix)
  const weeks = Array.isArray(r.weekly_merged) ? r.weekly_merged : []
  return {
    days: count(r.days) || SCOREBOARD_DAYS,
    apps: count(r.apps),
    userReports: count(r.user_reports),
    reporters: count(r.reporters),
    otherReports: count(r.other_reports),
    fixesMerged: count(r.fixes_merged),
    mergedFromUsers: count(r.merged_from_users),
    reviews: count(r.reviews),
    reviewsHold: count(r.reviews_hold),
    medianHoursToMergedFix: r.median_hours_to_merged_fix != null && Number.isFinite(median) ? Math.round(median * 10) / 10 : null,
    weeklyMerged: weeks
      .map((w) => (w && typeof w === 'object' ? (w as Record<string, unknown>) : {}))
      .filter((w) => typeof w.week_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.week_start))
      .map((w) => ({ weekStart: w.week_start as string, merged: count(w.merged) })),
    asOf: asOf.toISOString(),
  }
}

let cached: { at: number; data: PublicScoreboard } | null = null

/** Test hook: forget the cached board. */
export function resetScoreboardCache(): void {
  cached = null
}

export function registerPublicScoreboardRoutes(app: Hono<{ Variables: Variables }>, now: () => number = Date.now) {
  app.get('/v1/public/scoreboard', async (c) => {
    const t = now()
    if (cached && t - cached.at < SCOREBOARD_TTL_MS) {
      c.header('Cache-Control', 'public, max-age=900')
      return c.json({ ok: true, data: cached.data })
    }
    const db = getServiceClient()
    const { data, error } = await db.rpc('public_scoreboard', { p_days: SCOREBOARD_DAYS })
    if (error || !data) {
      log.warn('public scoreboard read failed', { err: error?.message })
      // A stale board beats an empty page; it still says when it was counted.
      if (cached) return c.json({ ok: true, data: cached.data })
      return c.json({ ok: false, error: { code: 'UNAVAILABLE', message: 'The numbers are not available right now.' } }, 503)
    }
    cached = { at: t, data: toPublicScoreboard(data, new Date(t)) }
    c.header('Cache-Control', 'public, max-age=900')
    return c.json({ ok: true, data: cached.data })
  })
}
