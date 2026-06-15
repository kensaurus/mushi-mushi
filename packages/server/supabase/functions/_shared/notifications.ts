import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'

const notifLog = log.child('notifications')

export type NotificationType =
  | 'classified'
  | 'confirmed'
  | 'fixed'
  | 'verified'
  | 'reopened'
  | 'dismissed'
  | 'points_awarded'
  | 'comment_reply'
  | 'admin_message_seen'

export type NotificationChannel = 'in_app' | 'email' | 'push'

interface NotificationPayload {
  message: string
  category?: string
  severity?: string
  points?: number
  reportId: string
}

interface ReporterChannelPrefs {
  in_app: boolean
  email: boolean
  push: boolean
}

const DEFAULT_CHANNEL_PREFS: ReporterChannelPrefs = {
  in_app: true,
  email: false,
  push: false,
}

export function buildNotificationMessage(type: NotificationType, context: {
  category?: string
  severity?: string
  points?: number
}): string {
  switch (type) {
    case 'classified':
      return `Your report was classified as ${context.category ?? 'unknown'}/${context.severity ?? 'unset'}`
    case 'confirmed':
      return `Your bug report was confirmed! +${context.points ?? 50} points`
    case 'fixed':
      return `The bug you reported has been fixed! Tap to confirm it works for you.`
    case 'verified':
      return `Thanks for confirming — your report is marked verified.`
    case 'reopened':
      return `We reopened your report and are looking into it again.`
    case 'dismissed':
      return `Your report was reviewed and closed`
    case 'points_awarded':
      return `You earned ${context.points ?? 0} points!`
    case 'comment_reply':
      return 'A developer replied to your report'
    case 'admin_message_seen':
      return 'The reporter replied in the triage thread'
    default:
      return 'Your report has been updated'
  }
}

async function loadReporterPrefs(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
): Promise<{ channels: ReporterChannelPrefs; email: string | null }> {
  const { data } = await db
    .from('reporter_notification_prefs')
    .select('channels, notification_email')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', reporterTokenHash)
    .maybeSingle()

  const channels = {
    ...DEFAULT_CHANNEL_PREFS,
    ...((data?.channels as Partial<ReporterChannelPrefs> | null) ?? {}),
  }
  return {
    channels,
    email: typeof data?.notification_email === 'string' ? data.notification_email : null,
  }
}

/**
 * Claim a delivery slot for (report, type, channel). The UNIQUE constraint on
 * those three columns makes the ledger idempotent. On a conflict (23505) we
 * load the existing row instead of giving up:
 *   - `sent` / `skipped` → terminal, return null (idempotent no-op).
 *   - `pending` / `failed` → bump `attempts`, re-arm to `pending`, reuse the id
 *     so a previously-failed delivery can actually be retried (the whole point
 *     of the `attempts` column + retry-ledger intent).
 */
async function claimDeliverySlot(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  reporterTokenHash: string,
  type: NotificationType,
  channel: NotificationChannel,
  payload: NotificationPayload,
): Promise<string | null> {
  const { data, error } = await db
    .from('notification_deliveries')
    .insert({
      project_id: projectId,
      report_id: reportId,
      reporter_token_hash: reporterTokenHash,
      notification_type: type,
      channel,
      status: 'pending',
      payload,
      attempts: 1,
    })
    .select('id')
    .maybeSingle()

  if (!error) return data?.id ?? null

  if (error.code !== '23505') {
    notifLog.error('delivery_claim_failed', { type, channel, error: error.message })
    return null
  }

  // Conflict: a delivery row already exists for this (report, type, channel).
  const { data: existing, error: selErr } = await db
    .from('notification_deliveries')
    .select('id, status, attempts')
    .eq('report_id', reportId)
    .eq('notification_type', type)
    .eq('channel', channel)
    .maybeSingle()

  if (selErr || !existing) {
    if (selErr) notifLog.error('delivery_conflict_lookup_failed', { type, channel, error: selErr.message })
    return null
  }

  // Already delivered (or deliberately skipped) → idempotent no-op.
  if (existing.status === 'sent' || existing.status === 'skipped') return null

  const { error: updErr } = await db
    .from('notification_deliveries')
    .update({
      status: 'pending',
      attempts: (typeof existing.attempts === 'number' ? existing.attempts : 0) + 1,
      payload,
      error_message: null,
    })
    .eq('id', existing.id)

  if (updErr) {
    notifLog.error('delivery_retry_arm_failed', { type, channel, error: updErr.message })
    return null
  }
  return existing.id as string
}

async function markDelivery(
  db: SupabaseClient,
  deliveryId: string,
  status: 'sent' | 'failed' | 'skipped',
  errorMessage?: string,
): Promise<void> {
  await db
    .from('notification_deliveries')
    .update({
      status,
      error_message: errorMessage ?? null,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
    })
    .eq('id', deliveryId)
    .then(() => null, () => null)
}

async function sendInAppNotification(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  reporterTokenHash: string,
  type: NotificationType,
  payload: NotificationPayload,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.from('reporter_notifications').insert({
    project_id: projectId,
    report_id: reportId,
    reporter_token_hash: reporterTokenHash,
    notification_type: type,
    channel: 'in_app',
    payload,
    sent_at: new Date().toISOString(),
  })
  if (error) {
    notifLog.error('in_app_insert_failed', { type, error: error.message })
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

async function sendEmailNotification(
  to: string,
  subject: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Mushi Mushi <noreply@mushi-mushi.dev>'
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function sendPushNotification(
  _db: SupabaseClient,
  _projectId: string,
  _reporterTokenHash: string,
  _message: string,
): Promise<{ ok: boolean; error?: string }> {
  // Honest stub. Real Web Push requires (1) VAPID JWT signing (RFC 8292),
  // (2) RFC 8291 `aes128gcm` payload encryption against each subscription's
  // p256dh/auth keys, (3) a client-side `PushManager.subscribe` path in the SDK
  // (not yet wired — `reporter_push_subscriptions` has no producer), and
  // (4) SSRF-safe validation of the stored push endpoint before any fetch.
  // Until those land, never POST to a client-supplied endpoint: an unsigned,
  // unencrypted body is rejected by every push service AND fetching an arbitrary
  // stored URL is an SSRF vector. Email remains the live delivery channel.
  return { ok: false, error: 'push_not_configured' }
}

/**
 * Fan-out a reporter notification across enabled channels.
 * Idempotent per (report_id, notification_type, channel) via notification_deliveries.
 */
export async function createNotification(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  reporterTokenHash: string,
  type: NotificationType,
  payload: NotificationPayload,
): Promise<void> {
  const prefs = await loadReporterPrefs(db, projectId, reporterTokenHash)
  const message = payload.message || buildNotificationMessage(type, payload)
  const fullPayload = { ...payload, message }

  // Build the channel list from the reporter's persisted opt-ins. `in_app`
  // defaults on (DEFAULT_CHANNEL_PREFS) but must be honoured when explicitly
  // disabled — hard-coding it here made `channels.in_app = false` a dead
  // setting.
  const channels: NotificationChannel[] = []
  if (prefs.channels.in_app) channels.push('in_app')
  if (prefs.channels.email && prefs.email) channels.push('email')
  if (prefs.channels.push) channels.push('push')

  for (const channel of channels) {
    const deliveryId = await claimDeliverySlot(
      db,
      projectId,
      reportId,
      reporterTokenHash,
      type,
      channel,
      fullPayload,
    )
    if (!deliveryId) continue

    if (channel === 'in_app') {
      const result = await sendInAppNotification(db, projectId, reportId, reporterTokenHash, type, fullPayload)
      await markDelivery(db, deliveryId, result.ok ? 'sent' : 'failed', result.error)
      continue
    }

    if (channel === 'email' && prefs.email) {
      // Tenant-neutral subject — this fan-out serves every project, not just
      // glot.it. Keep the product name generic so cross-tenant emails read
      // correctly.
      const result = await sendEmailNotification(
        prefs.email,
        `Mushi — ${type.replace(/_/g, ' ')}`,
        message,
      )
      await markDelivery(db, deliveryId, result.ok ? 'sent' : 'failed', result.error)
      continue
    }

    if (channel === 'push') {
      const result = await sendPushNotification(db, projectId, reporterTokenHash, message)
      await markDelivery(
        db,
        deliveryId,
        result.ok ? 'sent' : 'skipped',
        result.error,
      )
    }
  }
}
