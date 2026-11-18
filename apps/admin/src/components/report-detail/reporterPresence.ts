/**
 * FILE: apps/admin/src/components/report-detail/reporterPresence.ts
 * PURPOSE: Is there a person behind this report? Fresh-eyes sweep 2026-11-18:
 *          a Sentry import with "No user" showed "Reporter view: You reported
 *          this", "1 unread by reporter" and "Ask reporter", and listed
 *          "sentry-webhook" as a "Reporter token hash".
 */

import { reportSourceKind } from '../../lib/reportSourceKind'
import type { ReportDetail } from './types'

/**
 * A person (or the owner's own test) sent this, so there is someone to update
 * and ask. Sentry imports, alarms, setup tasks and checks have nobody.
 */
export function reportHasReporter(report: Pick<ReportDetail, 'source' | 'custom_metadata'>): boolean {
  const kind = reportSourceKind({
    source: report.source ?? null,
    metadata_source: (report.custom_metadata as { source?: string } | null)?.source ?? null,
  })
  return kind === 'user' || kind === 'test'
}

/** A stored reporter key (`rk1_<hex>` or a bare hex digest), not an intake name. */
export function isReporterKeyHash(value: string): boolean {
  return /^rk\d+_[0-9a-f]{16,}$/i.test(value) || /^[0-9a-f]{16,}$/i.test(value)
}
