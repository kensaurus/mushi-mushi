/**
 * FILE: packages/server/supabase/functions/_shared/report-close-reasons.ts
 * PURPOSE: Which close reasons a status change may store.
 *
 * A bulk dismiss used to leave `closed_reason` empty, so ten reports closed
 * as "couldn't reproduce" all told their reporters only "closed" (HHTP,
 * 2026-10-09). The reporter message and the console both follow the reason.
 *
 * `false_alarm` is only for a report Mushi's own check filed (site audit,
 * live-site watch, known vulnerability). There is no human reporter, so that
 * close sends no notification (`silentClosedReason`).
 */

/** `reports_closed_reason_check` (20261002120000, plus false_alarm). */
export const CLOSED_REASONS: ReadonlySet<string> = new Set([
  'duplicate',
  'not_reproducible',
  'wont_fix',
  'working_as_intended',
  'spam',
  'false_alarm',
])

/** `reports.source` values Mushi files itself. Kept in step with the console. */
const MUSHI_CHECK_SOURCES: ReadonlySet<string> = new Set([
  'site_audit',
  'site_watch',
  'security_advisory',
])

/** Closes that tell no reporter: spam, and a check of ours that was wrong. */
const SILENT_CLOSED_REASONS: ReadonlySet<string> = new Set(['spam', 'false_alarm'])

export function silentClosedReason(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && SILENT_CLOSED_REASONS.has(reason)
}

/**
 * Whether `reason` may be stored on a report from `source`. A false alarm on
 * a person's report would dismiss their bug and tell them nothing.
 */
export function closedReasonAllowed(reason: string, source: string | null | undefined): boolean {
  if (!CLOSED_REASONS.has(reason)) return false
  if (reason !== 'false_alarm') return true
  return typeof source === 'string' && MUSHI_CHECK_SOURCES.has(source)
}

/**
 * Reasons a bulk close accepts (`reports_closed_reason_check`, minus
 * "duplicate": that needs each report grouped under its canonical report
 * first, which a bulk close cannot check row by row, and minus "false_alarm":
 * a batch can mix a person's report with a check).
 */
export const BULK_CLOSED_REASONS: ReadonlySet<string> = new Set([
  'not_reproducible',
  'wont_fix',
  'working_as_intended',
  'spam',
])

/**
 * What `closed_reason` becomes for a bulk change to `status`:
 * - a dismiss keeps the reason given (or none);
 * - any other status clears an old reason, as the single-report PATCH does;
 * - no status change leaves the column alone (`undefined`).
 */
export function bulkClosedReason(
  status: unknown,
  reason: unknown,
): { ok: true; value: string | null | undefined } | { ok: false; message: string } {
  if (typeof status !== 'string') return { ok: true, value: undefined }
  if (status !== 'dismissed') return { ok: true, value: null }
  if (reason === undefined || reason === null || reason === '') return { ok: true, value: undefined }
  if (typeof reason !== 'string' || !BULK_CLOSED_REASONS.has(reason)) {
    return { ok: false, message: `reason must be one of: ${[...BULK_CLOSED_REASONS].join(', ')}` }
  }
  return { ok: true, value: reason }
}
