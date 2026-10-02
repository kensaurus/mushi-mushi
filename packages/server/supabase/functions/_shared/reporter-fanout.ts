/**
 * FILE: _shared/reporter-fanout.ts
 * PURPOSE: Email / push for a developer reply the comment trigger already
 *          wrote in-app (Plan 018 decision 6). Called by the
 *          reporter-notify-fanout edge function, which the trigger enqueues
 *          through mushi.edge_function_post.
 *
 * OVERVIEW:
 * - The trigger is the guaranteed in-app writer: the console inserts
 *   report_comments directly, so no API helper sees every reply. This module
 *   never inserts a second in-app row; it verifies the trigger's row exists
 *   (dedupe_key = comment id) before the ledger records in_app as `sent`.
 * - Email and push go through the delivery ledger, keyed by the comment id,
 *   so a re-run (pg_net retry, manual replay) is a no-op for a channel that
 *   already went out.
 * - A missing in-app row is an error, not a quiet success: it means the
 *   trigger did not run as designed.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { deliverForExistingInAppRow, type NotificationResult, type NotificationType } from './notifications.ts'

const fanoutLog = log.child('reporter-fanout')

export type FanoutOutcome =
  | { ok: true; skipped: 'not_reporter_visible' | 'no_reporter'; result?: undefined }
  | { ok: true; skipped?: undefined; result: NotificationResult; type: NotificationType }
  | { ok: false; code: 'COMMENT_NOT_FOUND' | 'IN_APP_ROW_MISSING' | 'DB_ERROR'; message: string }

/** Parse the trigger's body: `{ comment_id, report_id }`. */
export function parseFanoutBody(body: unknown): { commentId: string } | null {
  const raw = (body ?? {}) as { comment_id?: unknown }
  const id = raw.comment_id
  if (typeof id === 'number' && Number.isInteger(id) && id > 0) return { commentId: String(id) }
  if (typeof id === 'string' && /^\d{1,19}$/.test(id)) return { commentId: id }
  return null
}

export async function fanOutCommentNotification(db: SupabaseClient, commentId: string): Promise<FanoutOutcome> {
  const { data: comment, error: commentErr } = await db
    .from('report_comments')
    .select('id, report_id, project_id, author_kind, visible_to_reporter')
    .eq('id', commentId)
    .maybeSingle()
  if (commentErr) return { ok: false, code: 'DB_ERROR', message: commentErr.message }
  if (!comment) return { ok: false, code: 'COMMENT_NOT_FOUND', message: `comment ${commentId} not found` }
  const c = comment as { report_id: string; project_id: string; author_kind: string; visible_to_reporter: boolean }
  if (c.author_kind !== 'admin' || c.visible_to_reporter !== true) return { ok: true, skipped: 'not_reporter_visible' }

  const { data: report, error: reportErr } = await db
    .from('reports')
    .select('id, project_id, reporter_token_hash')
    .eq('id', c.report_id)
    .maybeSingle()
  if (reportErr) return { ok: false, code: 'DB_ERROR', message: reportErr.message }
  const tokenHash = (report as { reporter_token_hash?: string | null } | null)?.reporter_token_hash ?? null
  if (!report || !tokenHash) return { ok: true, skipped: 'no_reporter' }

  const { data: rows, error: rowErr } = await db
    .from('reporter_notifications')
    .select('notification_type, payload')
    .eq('report_id', c.report_id)
    .eq('reporter_token_hash', tokenHash)
    .eq('dedupe_key', commentId)
    .in('notification_type', ['comment_reply', 'info_requested'])
    .limit(1)
  if (rowErr) return { ok: false, code: 'DB_ERROR', message: rowErr.message }
  const row = (rows ?? [])[0] as { notification_type: NotificationType; payload: Record<string, unknown> | null } | undefined
  if (!row) {
    fanoutLog.error('in_app_row_missing', { commentId, reportId: c.report_id })
    return { ok: false, code: 'IN_APP_ROW_MISSING', message: `no in-app row for comment ${commentId}` }
  }

  const payload = row.payload ?? {}
  const result = await deliverForExistingInAppRow(db, {
    projectId: c.project_id,
    reportId: c.report_id,
    reporterTokenHash: tokenHash,
    type: row.notification_type,
    payload,
    message: typeof payload.message === 'string' ? payload.message : undefined,
    dedupeKey: commentId,
  })
  if (result.failed.length > 0) {
    fanoutLog.error('channel_delivery_failed', { commentId, failed: result.failed })
  }
  return { ok: true, result, type: row.notification_type }
}
