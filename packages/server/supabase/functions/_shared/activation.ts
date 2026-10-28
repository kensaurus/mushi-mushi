/**
 * FILE: packages/server/supabase/functions/_shared/activation.ts
 * PURPOSE: Decide the company funnel's `activated` event (November GTM plan,
 *          docs/plan-gtm-november-2026.md §6.1): an organization's FIRST real
 *          end-user report from a deployed app that got a diagnosis. Emitted
 *          once per organization by classify-report.
 *
 * Why not first_report_received / first_diagnosis_ready: those count any
 * report that is not a console fixture, including a test bug sent from a dev
 * server on localhost and the reports Mushi files itself (site watch, site
 * audit, known holes, skill runs, code audits, first-time user tests). The
 * critical audit of 2026-10-27 found installs stall exactly there, so
 * activation needs a person using a deployed app.
 *
 * Real end-user report:
 *   - reports.source is an end-user source (the widget or an SDK call), an
 *     allowlist: every source Mushi or an integration files is out;
 *   - custom_metadata.source is not a fixture or a hand-filed report
 *     (first-report.ts NOT_FIRST_REPORT_SOURCES);
 *   - the page URL is not a local dev URL (report-origin.ts). A native app
 *     report carries a screen name, not a URL; it has no dev origin to check
 *     and counts.
 *   - it has a diagnosis that is not the console's precomputed test fixture.
 *
 * Pure: no Deno globals, so vitest imports it.
 */

import { isNotFirstReportSource } from './first-report.ts'
import { isLocalDevUrl } from './report-origin.ts'

/** reports.source values a real end user produces (default 'widget'). */
export const END_USER_REPORT_SOURCES: ReadonlySet<string> = new Set(['widget', 'sdk'])

export interface ActivationReportRow {
  id: string
  source: string | null
  custom_metadata: Record<string, unknown> | null
  /** environment->>url */
  url: string | null
  stage2_model: string | null
  has_diagnosis: boolean
}

/** True when this report, once diagnosed, can activate its organization. */
export function isActivationReport(row: ActivationReportRow): boolean {
  if (!END_USER_REPORT_SOURCES.has(row.source ?? 'widget')) return false
  if (isNotFirstReportSource(row.custom_metadata)) return false
  if (isLocalDevUrl(row.url)) return false
  if (!row.has_diagnosis || row.stage2_model === 'precomputed') return false
  return true
}

/**
 * True when one of the organization's earlier diagnosed reports already
 * qualified, so this one is not the first. Only reports created before the
 * current one are passed in: two first reports diagnosed together each see
 * only the other when it is older, so exactly one emits (a tie emits twice
 * and the dedup key keeps one).
 */
export function hadEarlierActivation(earlier: readonly ActivationReportRow[]): boolean {
  return earlier.some(isActivationReport)
}

/** product_events dedup key: one `activated` per organization, ever. */
export function activationDedupKey(organizationId: string): string {
  return `activated:${organizationId}`
}
