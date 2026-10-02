/**
 * FILE: _shared/reporter-digest.ts
 * PURPOSE: The daily reporter digest (Plan 018 §4.3). Emails over the
 *          frequency cap are stored as `deferred` ledger rows; once a day each
 *          reporter gets ONE email listing them.
 *
 * OVERVIEW:
 * - Provider unset (RESEND_API_KEY / RESEND_FROM_EMAIL) → nothing is claimed;
 *   rows stay deferred and the run reports `not_configured`.
 * - Claim before send: rows move `deferred → pending` with this run's id, so
 *   two overlapping runs can not mail the same row twice. A claim older than
 *   STALE_CLAIM_MS (a run that died mid-send) goes back to `deferred` at the
 *   start of the next run, so nothing is stranded in `pending`.
 * - Re-check at send time: project gate, verification, unsubscribe. A row
 *   that may no longer be mailed is closed `skipped` with the reason.
 * - Send OK → rows `sent`. Send failed → rows back to `deferred` for the next
 *   run; after MAX_DIGEST_ATTEMPTS they are closed `failed`.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { emailProviderConfigured, sendTransactionalEmail } from './email.ts'
import { log } from './logger.ts'
import {
  emailBlockReason,
  loadProjectReporterSettings,
  loadReporterPrefs,
  type NotificationType,
} from './notifications.ts'
import {
  buildReporterDigestEmail,
  emailPageUrl,
  mintEmailToken,
  reporterEmailApiBase,
  reporterEmailPageBase,
  unsubscribeUrl,
} from './reporter-email.ts'
import { reporterSafePayload, reporterTitle } from './reporter-copy.ts'

const digestLog = log.child('reporter-digest')

/** Rows read per run; the rest wait for the next day. */
const DIGEST_BATCH = 500
/** A row whose digest failed this many times is closed `failed`. */
export const MAX_DIGEST_ATTEMPTS = 3
/** A digest claim this old belongs to a run that died; it is re-armed. */
export const STALE_CLAIM_MS = 60 * 60 * 1000

interface DeferredRow {
  id: string
  project_id: string
  report_id: string
  reporter_token_hash: string
  notification_type: NotificationType
  payload: Record<string, unknown> | null
  attempts: number | null
}

export interface DigestRunResult {
  not_configured: boolean
  /** Rows a crashed earlier run had claimed, put back to deferred. */
  rows_recovered: number
  reporters: number
  emails_sent: number
  rows_sent: number
  rows_skipped: number
  rows_retry: number
  rows_failed: number
}

async function setRows(
  db: SupabaseClient,
  ids: string[],
  patch: Record<string, unknown>,
): Promise<void> {
  if (ids.length === 0) return
  const { error } = await db.from('notification_deliveries').update(patch).in('id', ids)
  if (error) digestLog.error('digest_row_update_failed', { count: ids.length, error: error.message })
}

/** Send every reporter their digest. Never throws; the result counts what happened. */
export async function sendReporterDigests(db: SupabaseClient, now: Date = new Date()): Promise<DigestRunResult> {
  const result: DigestRunResult = {
    not_configured: false,
    rows_recovered: 0,
    reporters: 0,
    emails_sent: 0,
    rows_sent: 0,
    rows_skipped: 0,
    rows_retry: 0,
    rows_failed: 0,
  }
  // Re-arm claims left by a run that died between claim and send.
  const { data: recovered, error: recoverErr } = await db
    .from('notification_deliveries')
    .update({ status: 'deferred', digest_run_id: null, digest_claimed_at: null })
    .eq('channel', 'email')
    .eq('status', 'pending')
    .lt('digest_claimed_at', new Date(now.getTime() - STALE_CLAIM_MS).toISOString())
    .select('id')
  if (recoverErr) digestLog.error('digest_recover_failed', { error: recoverErr.message })
  result.rows_recovered = ((recovered ?? []) as unknown[]).length

  if (!emailProviderConfigured()) {
    result.not_configured = true
    return result
  }

  const { data, error } = await db
    .from('notification_deliveries')
    .select('id, project_id, report_id, reporter_token_hash, notification_type, payload, attempts')
    .eq('channel', 'email')
    .eq('status', 'deferred')
    .order('created_at', { ascending: true })
    .limit(DIGEST_BATCH)
  if (error) {
    digestLog.error('digest_load_failed', { error: error.message })
    return result
  }

  const groups = new Map<string, DeferredRow[]>()
  for (const row of (data ?? []) as DeferredRow[]) {
    const key = `${row.project_id}\u0000${row.reporter_token_hash}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  for (const rows of groups.values()) {
    const { project_id: projectId, reporter_token_hash: tokenHash } = rows[0]
    const runId = crypto.randomUUID()
    const { data: claimed, error: claimErr } = await db
      .from('notification_deliveries')
      .update({ status: 'pending', digest_run_id: runId, digest_claimed_at: now.toISOString() })
      .in('id', rows.map((r) => r.id))
      .eq('status', 'deferred')
      .select('id')
    if (claimErr) {
      digestLog.error('digest_claim_failed', { projectId, error: claimErr.message })
      continue
    }
    const claimedIds = new Set(((claimed ?? []) as Array<{ id: string }>).map((r) => r.id))
    const mine = rows.filter((r) => claimedIds.has(r.id))
    if (mine.length === 0) continue
    result.reporters++

    const [prefs, settings] = await Promise.all([
      loadReporterPrefs(db, projectId, tokenHash),
      loadProjectReporterSettings(db, projectId),
    ])
    const block = emailBlockReason(prefs, settings)
    if (block === 'not_configured') {
      // Provider vanished mid-run: put the rows back untouched.
      await setRows(db, mine.map((r) => r.id), { status: 'deferred', digest_run_id: null, digest_claimed_at: null })
      result.not_configured = true
      continue
    }
    if (block) {
      await setRows(db, mine.map((r) => r.id), { status: 'skipped', error_message: `digest_${block}`, digest_run_id: null })
      result.rows_skipped += mine.length
      continue
    }

    let token = prefs.unsubscribeToken
    if (!token) {
      token = mintEmailToken()
      const { error: tokErr } = await db
        .from('reporter_notification_prefs')
        .update({ unsubscribe_token: token })
        .eq('project_id', projectId)
        .eq('reporter_token_hash', tokenHash)
        .is('unsubscribe_token', null)
      if (tokErr) {
        await setRows(db, mine.map((r) => r.id), { status: 'deferred', digest_run_id: null, digest_claimed_at: null })
        result.rows_retry += mine.length
        continue
      }
    }

    const reportIds = [...new Set(mine.map((r) => r.report_id))]
    const { data: reports } = await db.from('reports').select('id, title, summary, description').in('id', reportIds)
    const titles = new Map<string, string>()
    for (const r of (reports ?? []) as Array<{ id: string; title: string | null; summary: string | null; description: string | null }>) {
      titles.set(r.id, reporterTitle(r))
    }

    const email = buildReporterDigestEmail({
      appName: settings.appName,
      items: mine.map((r) => ({
        reportTitle: titles.get(r.report_id) ?? null,
        message: String(reporterSafePayload({
          id: r.id,
          report_id: r.report_id,
          notification_type: r.notification_type,
          payload: r.payload,
          created_at: '',
        }).message ?? ''),
      })),
      unsubscribeUrl: unsubscribeUrl(reporterEmailApiBase(), token),
      unsubscribePageUrl: emailPageUrl(reporterEmailPageBase(), 'unsubscribe', token),
    })
    const sent = await sendTransactionalEmail({
      to: prefs.email as string,
      subject: email.subject,
      text: email.text,
      headers: email.headers,
      tags: { kind: 'reporter_digest' },
    })

    if (sent.ok) {
      await setRows(db, mine.map((r) => r.id), {
        status: 'sent',
        sent_at: new Date().toISOString(),
        error_message: 'digest',
        digest_run_id: runId,
      })
      result.emails_sent++
      result.rows_sent += mine.length
      continue
    }

    const reason = sent.reason === 'no_sender' || sent.reason === 'no_api_key' ? 'not_configured' : sent.error
    digestLog.warn('digest_send_failed', { projectId, reason })
    for (const row of mine) {
      const attempts = (row.attempts ?? 1) + 1
      if (attempts > MAX_DIGEST_ATTEMPTS) {
        await setRows(db, [row.id], { status: 'failed', attempts, error_message: `digest: ${reason}`, digest_run_id: null })
        result.rows_failed++
      } else {
        await setRows(db, [row.id], { status: 'deferred', attempts, error_message: `digest_retry: ${reason}`, digest_run_id: null, digest_claimed_at: null })
        result.rows_retry++
      }
    }
  }
  return result
}
