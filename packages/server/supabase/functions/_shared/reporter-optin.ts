/**
 * FILE: _shared/reporter-optin.ts
 * PURPOSE: A reporter's own notification choices (Plan 018 §4.1): email
 *          double opt-in, one-click unsubscribe, and Web Push subscriptions.
 *          The routes in api/routes/reporter-prefs.ts are thin wrappers.
 *
 * Rules:
 * - Nothing is on by default and nothing is pre-ticked: the reporter asks.
 * - A channel the project has not turned on, or the server can not send
 *   (RESEND_* / VAPID_* unset), is refused with a reason — never stored as
 *   "on" and then silently dropped.
 * - A new address gets ONE verification mail; no update is mailed until the
 *   reporter clicks it. The verify token is stored hashed; the unsubscribe
 *   token is rotated with every new address.
 * - Unsubscribe works from any mail ever sent to that address and needs no
 *   login (RFC 8058).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { emailProviderConfigured, sendTransactionalEmail } from './email.ts'
import { log } from './logger.ts'
import { loadProjectReporterSettings, loadReporterPrefs, type ProjectReporterSettings } from './notifications.ts'
import {
  VERIFY_LINK_TTL_MS,
  VERIFY_RESEND_INTERVAL_MS,
  buildVerifyEmail,
  isWellFormedEmailToken,
  maskEmail,
  mintEmailToken,
  normalizeEmail,
  reporterEmailApiBase,
  sha256Hex,
  verifyUrl,
} from './reporter-email.ts'
import { getVapidConfig, isAllowedPushEndpoint } from './web-push.ts'

const optinLog = log.child('reporter-optin')

/** Why a channel can not be offered right now. */
export type ChannelUnavailable = 'not_configured' | 'project_disabled'

export function emailAvailability(settings: Pick<ProjectReporterSettings, 'emailEnabled'>): ChannelUnavailable | null {
  if (!emailProviderConfigured()) return 'not_configured'
  if (!settings.emailEnabled) return 'project_disabled'
  return null
}

export function pushAvailability(settings: Pick<ProjectReporterSettings, 'pushEnabled'>): ChannelUnavailable | null {
  if (!getVapidConfig()) return 'not_configured'
  if (!settings.pushEnabled) return 'project_disabled'
  return null
}

export interface ReporterPrefsView {
  /** Masked: the full address never goes back to the browser. */
  email: string | null
  email_verified: boolean
  /** An address was given but the confirmation link was not clicked yet. */
  email_pending: boolean
  unsubscribed: boolean
  channels: { in_app: boolean; email: boolean; push: boolean }
  push_subscriptions: number
  available: { email: boolean; push: boolean }
  /** null when the channel can be offered. */
  unavailable_reason: { email: ChannelUnavailable | null; push: ChannelUnavailable | null }
}

export async function reporterPrefsView(
  db: SupabaseClient,
  projectId: string,
  tokenHash: string,
): Promise<ReporterPrefsView> {
  const [prefs, settings, subs] = await Promise.all([
    loadReporterPrefs(db, projectId, tokenHash),
    loadProjectReporterSettings(db, projectId),
    db.from('reporter_push_subscriptions').select('id').eq('project_id', projectId).eq('reporter_token_hash', tokenHash),
  ])
  const emailReason = emailAvailability(settings)
  const pushReason = pushAvailability(settings)
  return {
    email: maskEmail(prefs.email),
    email_verified: Boolean(prefs.email && prefs.emailVerifiedAt && !prefs.unsubscribedAt),
    email_pending: Boolean(prefs.email && !prefs.emailVerifiedAt),
    unsubscribed: Boolean(prefs.unsubscribedAt),
    channels: prefs.channels,
    push_subscriptions: ((subs.data ?? []) as unknown[]).length,
    available: { email: emailReason === null, push: pushReason === null },
    unavailable_reason: { email: emailReason, push: pushReason },
  }
}

export type PrefsUpdateResult =
  | { ok: true; verification_sent: boolean; view: ReporterPrefsView }
  | {
      ok: false
      status: 400 | 409 | 422 | 429 | 500 | 502
      code: 'VALIDATION_ERROR' | 'EMAIL_NOT_AVAILABLE' | 'PUSH_NOT_AVAILABLE' | 'RATE_LIMITED' | 'DB_ERROR' | 'EMAIL_SEND_FAILED'
      message: string
      reason?: ChannelUnavailable
    }

export interface PrefsUpdateInput {
  /** A new address (starts double opt-in), null to forget the address, undefined to keep it. */
  email?: unknown
  channels?: { email?: unknown; push?: unknown }
}

/**
 * Apply a reporter's choices. A new address is stored unverified, gets a
 * fresh verify token (hashed) and unsubscribe token, and exactly one
 * verification mail. Re-sending is throttled to once a minute.
 */
export async function updateReporterPrefs(
  db: SupabaseClient,
  projectId: string,
  tokenHash: string,
  input: PrefsUpdateInput,
  now: Date = new Date(),
): Promise<PrefsUpdateResult> {
  const wantsEmailOn = input.channels?.email === true || (typeof input.email === 'string' && input.email.trim() !== '')
  const wantsPushOn = input.channels?.push === true
  if (input.channels?.email !== undefined && typeof input.channels.email !== 'boolean') {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: 'channels.email must be true or false' }
  }
  if (input.channels?.push !== undefined && typeof input.channels.push !== 'boolean') {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: 'channels.push must be true or false' }
  }

  const [prefs, settings] = await Promise.all([
    loadReporterPrefs(db, projectId, tokenHash),
    loadProjectReporterSettings(db, projectId),
  ])

  if (wantsEmailOn) {
    const reason = emailAvailability(settings)
    if (reason) {
      return {
        ok: false,
        status: 409,
        code: 'EMAIL_NOT_AVAILABLE',
        reason,
        message: reason === 'not_configured' ? 'Email updates are not set up on this server yet.' : 'This app does not send email updates.',
      }
    }
  }
  if (wantsPushOn) {
    const reason = pushAvailability(settings)
    if (reason) {
      return {
        ok: false,
        status: 409,
        code: 'PUSH_NOT_AVAILABLE',
        reason,
        message: reason === 'not_configured' ? 'Push updates are not set up on this server yet.' : 'This app does not send push updates.',
      }
    }
  }

  const patch: Record<string, unknown> = {
    project_id: projectId,
    reporter_token_hash: tokenHash,
    updated_at: now.toISOString(),
  }
  const channels = { ...prefs.channels }
  let verifyToken: string | null = null
  let newAddress: string | null = null

  if (input.email === null) {
    // Forget the address entirely.
    Object.assign(patch, {
      notification_email: null,
      email_verified_at: null,
      email_verify_token_hash: null,
      email_verify_sent_at: null,
      unsubscribe_token: null,
    })
    channels.email = false
  } else if (input.email !== undefined) {
    const email = normalizeEmail(input.email)
    if (!email) return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: 'That does not look like an email address' }
    const sameVerified = email === prefs.email && prefs.emailVerifiedAt && !prefs.unsubscribedAt
    if (!sameVerified) {
      const { data: row } = await db
        .from('reporter_notification_prefs')
        .select('email_verify_sent_at')
        .eq('project_id', projectId)
        .eq('reporter_token_hash', tokenHash)
        .maybeSingle()
      const lastSent = (row as { email_verify_sent_at?: string | null } | null)?.email_verify_sent_at
      if (lastSent && now.getTime() - Date.parse(lastSent) < VERIFY_RESEND_INTERVAL_MS) {
        return { ok: false, status: 429, code: 'RATE_LIMITED', message: 'A confirmation email was just sent. Try again in a minute.' }
      }
      verifyToken = mintEmailToken()
      newAddress = email
      Object.assign(patch, {
        notification_email: email,
        email_verified_at: null,
        email_verify_token_hash: await sha256Hex(verifyToken),
        email_verify_sent_at: now.toISOString(),
        unsubscribed_at: null,
        // A new address never inherits the old address's unsubscribe link.
        unsubscribe_token: email === prefs.email && prefs.unsubscribeToken ? prefs.unsubscribeToken : mintEmailToken(),
      })
    }
    channels.email = true
  }
  if (typeof input.channels?.email === 'boolean') {
    if (input.channels.email && !prefs.email && !newAddress) {
      return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: 'Add an email address first' }
    }
    channels.email = input.channels.email
  }
  if (typeof input.channels?.push === 'boolean') channels.push = input.channels.push
  patch.channels = channels

  const { error } = await db.from('reporter_notification_prefs').upsert(patch, { onConflict: 'project_id,reporter_token_hash' })
  if (error) return { ok: false, status: 500, code: 'DB_ERROR', message: error.message }

  if (verifyToken && newAddress) {
    const mail = buildVerifyEmail({ appName: settings.appName, confirmUrl: verifyUrl(reporterEmailApiBase(), verifyToken) })
    const sent = await sendTransactionalEmail({
      to: newAddress,
      subject: mail.subject,
      text: mail.text,
      tags: { kind: 'reporter_verify' },
    })
    if (!sent.ok) {
      optinLog.warn('verify_email_failed', { projectId, reason: sent.reason })
      return { ok: false, status: 502, code: 'EMAIL_SEND_FAILED', message: 'We could not send the confirmation email. Try again later.' }
    }
  }
  return { ok: true, verification_sent: Boolean(verifyToken), view: await reporterPrefsView(db, projectId, tokenHash) }
}

export type EmailLinkResult =
  | { ok: true; projectId: string; appName: string | null }
  | { ok: false; code: 'INVALID' | 'EXPIRED' | 'DB_ERROR' }

/** Double opt-in: the reporter clicked the link in the verification mail. */
export async function verifyReporterEmail(db: SupabaseClient, token: unknown, now: Date = new Date()): Promise<EmailLinkResult> {
  if (!isWellFormedEmailToken(token)) return { ok: false, code: 'INVALID' }
  const hash = await sha256Hex(token)
  const { data, error } = await db
    .from('reporter_notification_prefs')
    .select('project_id, reporter_token_hash, email_verify_sent_at')
    .eq('email_verify_token_hash', hash)
    .maybeSingle()
  if (error) return { ok: false, code: 'DB_ERROR' }
  const row = data as { project_id: string; reporter_token_hash: string; email_verify_sent_at: string | null } | null
  if (!row) return { ok: false, code: 'INVALID' }
  if (!row.email_verify_sent_at || now.getTime() - Date.parse(row.email_verify_sent_at) > VERIFY_LINK_TTL_MS) {
    return { ok: false, code: 'EXPIRED' }
  }
  const { error: updErr } = await db
    .from('reporter_notification_prefs')
    .update({
      email_verified_at: now.toISOString(),
      email_verify_token_hash: null,
      unsubscribed_at: null,
      updated_at: now.toISOString(),
    })
    .eq('project_id', row.project_id)
    .eq('reporter_token_hash', row.reporter_token_hash)
    .eq('email_verify_token_hash', hash)
  if (updErr) return { ok: false, code: 'DB_ERROR' }
  const settings = await loadProjectReporterSettings(db, row.project_id)
  return { ok: true, projectId: row.project_id, appName: settings.appName }
}

/** One-click unsubscribe (RFC 8058). Idempotent: a second click still succeeds. */
export async function unsubscribeReporterEmail(db: SupabaseClient, token: unknown, now: Date = new Date()): Promise<EmailLinkResult> {
  if (!isWellFormedEmailToken(token)) return { ok: false, code: 'INVALID' }
  const { data, error } = await db
    .from('reporter_notification_prefs')
    .select('project_id, reporter_token_hash, channels, unsubscribed_at')
    .eq('unsubscribe_token', token)
    .maybeSingle()
  if (error) return { ok: false, code: 'DB_ERROR' }
  const row = data as {
    project_id: string
    reporter_token_hash: string
    channels: Record<string, unknown> | null
    unsubscribed_at: string | null
  } | null
  if (!row) return { ok: false, code: 'INVALID' }
  if (!row.unsubscribed_at) {
    const { error: updErr } = await db
      .from('reporter_notification_prefs')
      .update({
        unsubscribed_at: now.toISOString(),
        channels: { ...(row.channels ?? {}), email: false },
        updated_at: now.toISOString(),
      })
      .eq('project_id', row.project_id)
      .eq('reporter_token_hash', row.reporter_token_hash)
    if (updErr) return { ok: false, code: 'DB_ERROR' }
  }
  const settings = await loadProjectReporterSettings(db, row.project_id)
  return { ok: true, projectId: row.project_id, appName: settings.appName }
}

export interface PushSubscriptionInput {
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
}

const B64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/

export type PushSaveResult =
  | { ok: true }
  | { ok: false; status: 409 | 422 | 500; code: 'VALIDATION_ERROR' | 'PUSH_NOT_AVAILABLE' | 'DB_ERROR'; message: string; reason?: ChannelUnavailable }

/** Store a reporter's browser push subscription (endpoint allow-list enforced) and turn push on. */
export async function saveReporterPushSubscription(
  db: SupabaseClient,
  projectId: string,
  tokenHash: string,
  input: PushSubscriptionInput,
  userAgent: string | null,
): Promise<PushSaveResult> {
  const endpoint = typeof input.endpoint === 'string' ? input.endpoint.trim() : ''
  const p256dh = typeof input.keys?.p256dh === 'string' ? input.keys.p256dh.trim() : ''
  const auth = typeof input.keys?.auth === 'string' ? input.keys.auth.trim() : ''
  if (!endpoint || endpoint.length > 1024 || !p256dh || p256dh.length > 256 || !auth || auth.length > 64) {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: 'endpoint and keys.p256dh / keys.auth are required' }
  }
  if (!B64URL_RE.test(p256dh) || !B64URL_RE.test(auth)) {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: 'keys must be base64url' }
  }
  // ADR 0012: only real push services, so a stored URL is never an SSRF target.
  if (!isAllowedPushEndpoint(endpoint)) {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: 'endpoint is not a known push service' }
  }
  const settings = await loadProjectReporterSettings(db, projectId)
  const reason = pushAvailability(settings)
  if (reason) return { ok: false, status: 409, code: 'PUSH_NOT_AVAILABLE', message: 'Push updates are not available for this app', reason }

  const { error } = await db.from('reporter_push_subscriptions').upsert(
    {
      project_id: projectId,
      reporter_token_hash: tokenHash,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent ? userAgent.slice(0, 300) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,reporter_token_hash,endpoint' },
  )
  if (error) return { ok: false, status: 500, code: 'DB_ERROR', message: error.message }

  const prefs = await loadReporterPrefs(db, projectId, tokenHash)
  const { error: prefErr } = await db.from('reporter_notification_prefs').upsert(
    { project_id: projectId, reporter_token_hash: tokenHash, channels: { ...prefs.channels, push: true }, updated_at: new Date().toISOString() },
    { onConflict: 'project_id,reporter_token_hash' },
  )
  if (prefErr) return { ok: false, status: 500, code: 'DB_ERROR', message: prefErr.message }
  return { ok: true }
}

/** Remove one subscription; push turns off when it was the reporter's last device. */
export async function removeReporterPushSubscription(
  db: SupabaseClient,
  projectId: string,
  tokenHash: string,
  endpoint: unknown,
): Promise<{ ok: true; removed: number } | { ok: false; status: 422 | 500; code: 'VALIDATION_ERROR' | 'DB_ERROR'; message: string }> {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', message: 'endpoint is required' }
  }
  const { data, error } = await db
    .from('reporter_push_subscriptions')
    .delete()
    .eq('project_id', projectId)
    .eq('reporter_token_hash', tokenHash)
    .eq('endpoint', endpoint.trim())
    .select('id')
  if (error) return { ok: false, status: 500, code: 'DB_ERROR', message: error.message }
  const { data: left } = await db
    .from('reporter_push_subscriptions')
    .select('id')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', tokenHash)
  if (((left ?? []) as unknown[]).length === 0) {
    const prefs = await loadReporterPrefs(db, projectId, tokenHash)
    if (prefs.channels.push) {
      await db
        .from('reporter_notification_prefs')
        .update({ channels: { ...prefs.channels, push: false }, updated_at: new Date().toISOString() })
        .eq('project_id', projectId)
        .eq('reporter_token_hash', tokenHash)
    }
  }
  return { ok: true, removed: ((data ?? []) as unknown[]).length }
}
