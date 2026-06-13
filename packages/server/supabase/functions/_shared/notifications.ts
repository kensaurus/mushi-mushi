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

  if (error) {
    if (error.code === '23505') return null
    notifLog.error('delivery_claim_failed', { type, channel, error: error.message })
    return null
  }
  return data?.id ?? null
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
): Promise<void> {
  const { error } = await db.from('reporter_notifications').insert({
    project_id: projectId,
    report_id: reportId,
    reporter_token_hash: reporterTokenHash,
    notification_type: type,
    channel: 'in_app',
    payload,
    sent_at: new Date().toISOString(),
  })
  if (error) notifLog.error('in_app_insert_failed', { type, error: error.message })
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
  // Stub — wired when native/web push tokens are collected in Phase 4.
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

  const channels: NotificationChannel[] = ['in_app']
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
      await sendInAppNotification(db, projectId, reportId, reporterTokenHash, type, fullPayload)
      await markDelivery(db, deliveryId, 'sent')
      continue
    }

    if (channel === 'email' && prefs.email) {
      const result = await sendEmailNotification(
        prefs.email,
        `glot.it / Mushi — ${type.replace(/_/g, ' ')}`,
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
