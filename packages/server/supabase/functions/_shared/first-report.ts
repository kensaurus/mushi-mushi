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
  const firstReal = oldestAscending.find((row) => !isNonRealReport(row.custom_metadata));
  return firstReal?.id === reportId;
}
