/**
 * FILE: packages/server/supabase/functions/_shared/report-source-kind.ts
 * PURPOSE: Where a report came from, in five words a person reads at a
 *          glance: a user, Sentry, an alarm, a setup task, a test, or one of
 *          Mushi Mushi's own checks. GET /v1/admin/reports filters by it
 *          (`?source=`), and the console tags each bug with it.
 *
 *          Owner's walkthrough, 2026-11-17: CloudWatch alarms and a setup
 *          task ("Add the Mushi SDK to kensaur.us") read as user bugs with
 *          High/Medium/Low beside them, so triage could not tell them apart.
 *
 * Pure: no Deno or database imports. Mirrored by the console's
 * `apps/admin/src/lib/reportSourceKind.ts`; keep the two lists in step.
 */

export const REPORT_SOURCE_KINDS = ['user', 'sentry', 'alarm', 'task', 'test', 'check'] as const
type ReportSourceKind = (typeof REPORT_SOURCE_KINDS)[number]

/** `reports.source` values for each kind except `user` and `test`. */
export const SOURCE_VALUES_BY_KIND: Readonly<Record<'sentry' | 'alarm' | 'task' | 'check', readonly string[]>> = {
  sentry: ['sentry'],
  alarm: ['cloudwatch'],
  task: ['sdk_health'],
  check: ['site_watch', 'site_audit', 'code_audit', 'security_advisory', 'library_modernizer', 'skill_run', 'fresh_eyes', 'ux_loop', 'ux_scorecard'],
}

/** custom_metadata.source of a "Send a test report" sample. */
const TEST_REPORT_METADATA_SOURCE = 'admin_test_report'

const NOT_USER = [...SOURCE_VALUES_BY_KIND.sentry, ...SOURCE_VALUES_BY_KIND.alarm, ...SOURCE_VALUES_BY_KIND.task, ...SOURCE_VALUES_BY_KIND.check]

/**
 * The PostgREST filter for one kind: `in` on `source`, or `or` groups to AND
 * into the list's other `or` filters (combineOrGroups).
 */
export function reportSourceKindFilter(
  kind: ReportSourceKind,
): { kind: 'in'; values: readonly string[] } | { kind: 'eq_meta'; value: string } | { kind: 'or'; groups: string[] } {
  if (kind === 'test') return { kind: 'eq_meta', value: TEST_REPORT_METADATA_SOURCE }
  if (kind === 'user') {
    return {
      kind: 'or',
      groups: [
        `source.is.null,source.not.in.(${NOT_USER.join(',')})`,
        `custom_metadata->>source.is.null,custom_metadata->>source.neq.${TEST_REPORT_METADATA_SOURCE}`,
      ],
    }
  }
  return { kind: 'in', values: SOURCE_VALUES_BY_KIND[kind] }
}

export function isReportSourceKind(v: string): v is ReportSourceKind {
  return (REPORT_SOURCE_KINDS as readonly string[]).includes(v)
}
