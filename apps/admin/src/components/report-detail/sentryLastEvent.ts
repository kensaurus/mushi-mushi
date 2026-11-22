/**
 * FILE: apps/admin/src/components/report-detail/sentryLastEvent.ts
 * PURPOSE: When Mushi Mushi last received an event for a report that came
 *          from Sentry, so an old error does not read as live (report
 *          3a5cb64c, 2026-11-22: a 4-day-old Sentry error with nothing on
 *          the page saying how old it was).
 *
 *          Sentry's own "last seen" comes first (`sentryLastSeenAt`): the
 *          report's Sentry links carry `last_seen_at` since 2026-11-22,
 *          stored whenever Mushi hears about an issue it already linked
 *          (_shared/sentry-ingest.ts recordSentryLastSeen). Older links, and
 *          an API from before that, have none; then the page falls back to
 *          what is on the report row (`sentryLastEventAt`): when Mushi filed
 *          it from a Sentry event, and `regressed_at`, set when a Sentry
 *          alert reopened a fixed report. That fallback says what Mushi
 *          received, not what Sentry saw.
 */

import type { ReportDetail, ReportSentryLink } from './types'

/** A Sentry link as the report API returns it since 2026-11-22. */
export type SentryLinkSeen = ReportSentryLink & { last_seen_at?: string | null }

/** ISO time Sentry last saw any of the report's linked issues, or null when none was recorded. */
export function sentryLastSeenAt(links: ReadonlyArray<SentryLinkSeen> | null | undefined): string | null {
  const times = (links ?? []).map((l) => (l.last_seen_at ? Date.parse(l.last_seen_at) : NaN)).filter((t) => Number.isFinite(t))
  return times.length === 0 ? null : new Date(Math.max(...times)).toISOString()
}

type SentrySource = Pick<ReportDetail, 'source' | 'created_at' | 'regressed_at'> & {
  environment?: { userAgent?: string | null } | null
}

/** ISO time of the newest Sentry event Mushi received for the report, or null when it did not come from Sentry. */
export function sentryLastEventAt(report: SentrySource): string | null {
  const fromSentry = report.source === 'sentry' || report.environment?.userAgent === 'sentry-webhook'
  if (!fromSentry) return null
  const times = [report.created_at, report.regressed_at]
    .map((v) => (v ? Date.parse(v) : NaN))
    .filter((t) => Number.isFinite(t))
  if (times.length === 0) return null
  return new Date(Math.max(...times)).toISOString()
}
