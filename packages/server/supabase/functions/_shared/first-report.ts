/**
 * FILE: packages/server/supabase/functions/_shared/first-report.ts
 * PURPOSE: Decide whether a just-ingested report is its project's FIRST real
 *          report — the `first_report_received` activation event (company
 *          funnel, docs/plan-gtm.md → Workstream A).
 *
 * The dedup key on product_events (`first_report_received:<projectId>`) only
 * guarantees the event is written once. It does not guarantee the report is
 * actually the first: a project that already had reports before the emitter
 * shipped would otherwise get a "first report" stamped at its first report
 * after deploy. So the emitter asks this helper first, with the project's
 * oldest reports ordered by (created_at, id).
 *
 * Ordering by (created_at, id) is what makes concurrent first reports safe:
 * every concurrent ingest computes the same winner, so exactly one emits
 * instead of each seeing the other and both skipping.
 *
 * The same ordering drives two more callers: fast-filter sends the first real
 * report to Stage 2 even when Stage 1 is confident (isEarlyRealReport), and
 * the retention sweep never deletes the first real report (firstRealReportId).
 */

/** Report sources that never count as a real report (console test, demo seed). */
export const NON_REAL_REPORT_SOURCES: ReadonlySet<string> = new Set([
  'admin_test_report',
  'mushi-marketing-seed',
]);

export interface OldestReportRow {
  id: string;
  custom_metadata: Record<string, unknown> | null;
}

/** True when the report's `custom_metadata.source` marks it as not real. */
export function isNonRealReport(customMetadata: Record<string, unknown> | null | undefined): boolean {
  const source = customMetadata?.source;
  return typeof source === 'string' && NON_REAL_REPORT_SOURCES.has(source);
}

/**
 * Given the project's oldest reports in (created_at ASC, id ASC) order, return
 * true only when `reportId` is the first real one.
 */
export function isFirstRealReport(oldestAscending: readonly OldestReportRow[], reportId: string): boolean {
  return firstRealReportId(oldestAscending) === reportId;
}

/** The id of the first real report in (created_at ASC, id ASC) order, or null. */
export function firstRealReportId(oldestAscending: readonly OldestReportRow[]): string | null {
  return oldestAscending.find((row) => !isNonRealReport(row.custom_metadata))?.id ?? null;
}

/**
 * How many of a project's earliest real reports always get the full Stage-2
 * diagnosis, even when Stage 1 is confident enough to stop. A new user's
 * first report is the moment they judge the product: a Stage-1-only result
 * has no root cause and no fix. 1 = only the very first real report.
 */
export const FULL_DIAGNOSIS_FIRST_REAL_REPORTS = 1;

/**
 * True when `reportId` is real and fewer than `limit` real reports precede it
 * in the (created_at ASC, id ASC) list. False when the report is not in the
 * list (more earlier rows than were read), which keeps the caller on its
 * normal path rather than guessing.
 */
export function isEarlyRealReport(
  oldestAscending: readonly OldestReportRow[],
  reportId: string,
  limit: number = FULL_DIAGNOSIS_FIRST_REAL_REPORTS,
): boolean {
  let realBefore = 0;
  for (const row of oldestAscending) {
    if (row.id === reportId) return !isNonRealReport(row.custom_metadata) && realBefore < limit;
    if (!isNonRealReport(row.custom_metadata)) realBefore++;
  }
  return false;
}
