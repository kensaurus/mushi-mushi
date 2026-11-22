/**
 * FILE: packages/server/supabase/functions/_shared/report-sources.ts
 * PURPOSE: Which `reports.source` values Mushi files itself (ADR 0063).
 *
 * 2026-11-21: 550 open code-audit findings from one sweep sat in the same
 * open counts as the bugs people reported, so the counts said nothing about
 * users. Every open count a person reads splits the two: reports from people
 * and production (widget, sdk, api, sentry, store reviews…) and Mushi's own
 * checks.
 *
 * No env reads and only pure imports: the Deno CI test runs without permissions.
 */

import { SOURCE_VALUES_BY_KIND } from './report-source-kind.ts'

/**
 * `reports.source` values a Mushi check or setup task files, with no person
 * behind them: report-source-kind.ts's `check` and `task` kinds, so the
 * console's source tags and these counts never disagree.
 */
export const AUTOMATED_REPORT_SOURCES: readonly string[] = [...SOURCE_VALUES_BY_KIND.check, ...SOURCE_VALUES_BY_KIND.task]

const AUTOMATED: ReadonlySet<string> = new Set(AUTOMATED_REPORT_SOURCES)

/** True when Mushi filed the report itself; a missing source counts as a person's. */
export function isAutomatedReportSource(source: string | null | undefined): boolean {
  return typeof source === 'string' && AUTOMATED.has(source)
}
