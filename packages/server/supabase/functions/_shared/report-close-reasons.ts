/**
 * FILE: packages/server/supabase/functions/_shared/report-close-reasons.ts
 * PURPOSE: The close reason a bulk status change writes.
 *
 * A bulk dismiss used to leave `closed_reason` empty, so ten reports closed
 * as "couldn't reproduce" all told their reporters only "closed" (HHTP,
 * 2026-10-09). The reporter message and the console both follow the reason.
 */

/**
 * Reasons a bulk close accepts (`reports_closed_reason_check`, minus
 * "duplicate": that needs each report grouped under its canonical report
 * first, which a bulk close cannot check row by row).
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
