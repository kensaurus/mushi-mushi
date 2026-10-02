/**
 * FILE: _shared/release-reporters.ts
 * PURPOSE: A published release tells each reporter it fixed (Plan 018 §5).
 *
 * OVERVIEW:
 * - `notifyReleaseReporters` — per report in `releases.fixed_report_ids` (this
 *   project only): stamp `fixed_in_version` / `fixed_release_id`, move open
 *   reports to the stored fixed state, and send ONE `released` message keyed
 *   by the release id (held in review mode). A `verified` report keeps its
 *   status (the reporter already confirmed; asking again would be noise) and
 *   a `dismissed` one is left alone — a release can not resurrect a close.
 * - `stampDeliveredReleaseCredits` — `release_credits.notified_at` is stamped
 *   only for credits whose report has a `sent` in-app ledger row for this
 *   release. Until 2026-10 every credit was stamped without anything being
 *   sent. Called at publish and again when a held message is released.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { buildNotificationMessage, createNotification, notifyFollowers } from './notifications.ts'
import { runStatusTransitionSideEffects } from './report-transition.ts'
import { toStoredStatus } from './report-status.ts'
import { awardPoints } from './reputation.ts'

const relLog = log.child('release-reporters')

export interface ReleaseDelivery {
  reports_listed: number
  reports_resolved: number
  reports_not_found: number
  reports_skipped_dismissed: number
  reporters_notified: number
  reporters_held: number
  reporters_failed: number
  reports_without_reporter: number
}

export async function notifyReleaseReporters(
  db: SupabaseClient,
  release: { id: string; project_id: string; version: string; fixed_report_ids?: string[] | null },
  actorUserId: string,
): Promise<{ ok: true; delivery: ReleaseDelivery } | { ok: false; error: string }> {
  const fixedIds = [...new Set(release.fixed_report_ids ?? [])]
  const delivery: ReleaseDelivery = {
    reports_listed: fixedIds.length,
    reports_resolved: 0,
    reports_not_found: 0,
    reports_skipped_dismissed: 0,
    reporters_notified: 0,
    reporters_held: 0,
    reporters_failed: 0,
    reports_without_reporter: 0,
  }
  if (fixedIds.length === 0) return { ok: true, delivery }

  // fixed_report_ids is caller-editable: only this project's reports.
  const { data: rows, error } = await db
    .from('reports')
    .select('id, status, reporter_token_hash')
    .in('id', fixedIds)
    .eq('project_id', release.project_id)
  if (error) return { ok: false, error: `loading ${fixedIds.length} fixed report(s) failed: ${error.message}` }
  const reports = (rows ?? []) as Array<{ id: string; status: string; reporter_token_hash: string | null }>
  delivery.reports_not_found = fixedIds.length - reports.length
  const message = buildNotificationMessage('released', { version: release.version })

  for (const report of reports) {
    if (report.status === 'dismissed') {
      delivery.reports_skipped_dismissed++
      continue
    }
    const verified = report.status === 'verified'
    const patch: Record<string, unknown> = { fixed_in_version: release.version, fixed_release_id: release.id }
    if (!verified) patch.status = 'fixed'
    const { error: updErr } = await db
      .from('reports')
      .update(patch)
      .eq('id', report.id)
      .eq('project_id', release.project_id)
    if (updErr) {
      relLog.error('release_report_resolve_failed', { releaseId: release.id, reportId: report.id, error: updErr.message })
      delivery.reporters_failed++
      continue
    }
    delivery.reports_resolved++

    if (!verified && toStoredStatus(report.status) !== 'fixed') {
      // Plugins and linked issues; the reporter hears `released` below, not `fixed`.
      runStatusTransitionSideEffects(db, {
        reportId: report.id,
        projectId: release.project_id,
        reporterTokenHash: report.reporter_token_hash,
        previousStatus: report.status,
        newStatus: 'fixed',
        actor: { kind: 'admin', id: actorUserId },
        notifyReporter: false,
      })
      if (report.reporter_token_hash) {
        await awardPoints(db, release.project_id, report.reporter_token_hash, { action: 'fixed' }).catch((e) =>
          relLog.warn('release_points_award_failed', { reportId: report.id, err: String(e) }),
        )
      }
    }

    // The reporter already confirmed a verified report works; don't ask again.
    if (verified) continue
    if (!report.reporter_token_hash) {
      delivery.reports_without_reporter++
      continue
    }
    const payload = { message, reportId: report.id, version: release.version }
    const results = [
      await createNotification(db, release.project_id, report.id, report.reporter_token_hash, 'released', payload, {
        reviewable: true,
        dedupeKey: release.id,
      }),
      ...(await notifyFollowers(db, release.project_id, report.id, 'released', payload, {
        reviewable: true,
        dedupeKey: release.id,
      })),
    ]
    for (const r of results) {
      if (r.held) delivery.reporters_held++
      else if (r.delivered.includes('in_app') || r.duplicate.includes('in_app')) delivery.reporters_notified++
      else delivery.reporters_failed++
    }
  }
  return { ok: true, delivery }
}

/**
 * Stamp `notified_at` on this release's credits whose report has a delivered
 * (`sent`) in-app `released` ledger row. Anything else stays unstamped. A
 * ledger read error stamps nothing and is returned, never swallowed.
 */
export async function stampDeliveredReleaseCredits(
  db: SupabaseClient,
  releaseId: string,
): Promise<{ ok: true; stamped: number; pending: number } | { ok: false; error: string }> {
  const { data: credits, error } = await db
    .from('release_credits')
    .select('id, report_id')
    .eq('release_id', releaseId)
    .is('notified_at', null)
  if (error) return { ok: false, error: `fetching credits failed: ${error.message}` }
  const rows = (credits ?? []) as Array<{ id: string; report_id: string | null }>
  const reportIds = [...new Set(rows.map((r) => r.report_id).filter((id): id is string => Boolean(id)))]
  if (reportIds.length === 0) return { ok: true, stamped: 0, pending: rows.length }

  const { data: ledger, error: ledgerErr } = await db
    .from('notification_deliveries')
    .select('report_id')
    .eq('notification_type', 'released')
    .eq('channel', 'in_app')
    .eq('status', 'sent')
    .eq('dedupe_key', releaseId)
    .in('report_id', reportIds)
  if (ledgerErr) return { ok: false, error: `reading the delivery ledger failed: ${ledgerErr.message}` }
  const delivered = new Set(((ledger ?? []) as Array<{ report_id: string }>).map((l) => l.report_id))

  const stampIds = rows.filter((r) => r.report_id && delivered.has(r.report_id)).map((r) => r.id)
  if (stampIds.length === 0) return { ok: true, stamped: 0, pending: rows.length }
  const { error: updErr } = await db
    .from('release_credits')
    .update({ notified_at: new Date().toISOString() })
    .in('id', stampIds)
    .is('notified_at', null)
  if (updErr) return { ok: false, error: `marking ${stampIds.length} credit(s) notified failed: ${updErr.message}` }
  return { ok: true, stamped: stampIds.length, pending: rows.length - stampIds.length }
}
