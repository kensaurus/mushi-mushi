/**
 * FILE: apps/admin/src/components/report-detail/sentryLastEvent.ts
 * PURPOSE: When Mushi Mushi last received an event for a report that came
 *          from Sentry, so an old error does not read as live (report
 *          3a5cb64c, 2026-11-22: a 4-day-old Sentry error with nothing on
 *          the page saying how old it was).
 *
 *          Only what is on the report row: when Mushi filed it from a Sentry
 *          event, and `regressed_at`, set when a Sentry alert reopened a fixed
 *          report (_shared/sentry-ingest.ts). Sentry's own "last seen" is not
 *          stored: further events on an open report are deduplicated without
 *          a write, so the label says what Mushi received, not what Sentry saw.
 */

import type { ReportDetail } from './types'

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
