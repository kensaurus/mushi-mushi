import { emailProviderConfigured, sendTransactionalEmail } from './email.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { getVapidConfig, sendWebPushToSubscription } from './web-push.ts'
import {
  PUSH_TYPES,
  buildReporterUpdateEmail,
  emailCapDecision,
  mintEmailToken,
  pushCapAllows,
  renderTemplate,
  reporterEmailApiBase,
  sanitizeTemplates,
  templateKeyFor,
  unsubscribeUrl,
  type ChannelSkipReason,
  type TemplatableType,
} from './reporter-email.ts'

const notifLog = log.child('notifications')

export type NotificationType =
  | 'classified'
  | 'reviewing'
  | 'confirmed'
  | 'fix_started'
  | 'fixed'
  | 'released'
  | 'verified'
  | 'reopened'
  | 'dismissed'
  | 'closed'
  | 'duplicate_linked'
  | 'info_requested'
  | 'points_awarded'
  | 'comment_reply'
  | 'admin_message_seen'

/**
 * Every type a server writer emits. `reporter_notifications_type_check`
 * (migration 20261002120100) must list each of these, or that writer's insert
 * fails; a contract test pins the two lists together.
 */
export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  'classified',
  'reviewing',
  'confirmed',
  'fix_started',
  'fixed',
  'released',
  'verified',
  'reopened',
  'dismissed',
  'closed',
  'duplicate_linked',
  'info_requested',
  'points_awarded',
  'comment_reply',
  'admin_message_seen',
]

export type NotificationChannel = 'in_app' | 'email' | 'push'

/** Low-value events stay in-app only, whatever the reporter opted into (Plan 018 §4.3). */
const IN_APP_ONLY_TYPES: ReadonlySet<NotificationType> = new Set([
  'classified',
  'reviewing',
  'confirmed',
  'fix_started',
  'duplicate_linked',
  'points_awarded',
  'admin_message_seen',
])

export interface NotificationPayload {
  message: string
  reportId: string
  points?: number
  /** Release version for `released` (renders "Shipped in v{version}"). */
  version?: string | null
  /** `closed_reason` for `dismissed` / `closed`. */
  closedReason?: string | null
  /** For `duplicate_linked`: the report whose updates the reporter now follows. */
  canonicalReportId?: string
  /** For `released`: how many reports the release fixed (the `{n}` template placeholder). */
  fixedCount?: number
  /**
   * Accepted for older callers but never stored: internal triage labels must
   * not reach a reporter (Plan 018 §3 copy rule).
   */
  category?: string
  severity?: string
}

export interface CreateNotificationOptions {
  /** Distinguishes rows of one (report, type): comment id, release id, follower key. */
  dedupeKey?: string | null
  /** Pipeline message: held in the console Outbox when the project is in review mode. */
  reviewable?: boolean
}

/**
 * What happened on each channel. `duplicate` = already delivered earlier
 * (idempotent no-op); `deferred` = an email over the frequency cap, sent in
 * the daily digest instead.
 */
export interface NotificationResult {
  held: boolean
  delivered: NotificationChannel[]
  failed: NotificationChannel[]
  skipped: NotificationChannel[]
  duplicate: NotificationChannel[]
  deferred: NotificationChannel[]
}

function emptyResult(): NotificationResult {
  return { held: false, delivered: [], failed: [], skipped: [], duplicate: [], deferred: [] }
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
  version?: string | null
}): string {
  switch (type) {
    // Neutral on purpose: the classification (category / severity) is internal.
    case 'classified':
    case 'reviewing':
      return 'The developer is looking into it'
    case 'confirmed':
      return `Your bug report was confirmed! +${context.points ?? 50} points`
    case 'fix_started':
      return 'A fix is in progress'
    case 'fixed':
      return `The bug you reported has been fixed! Tap to confirm it works for you.`
    case 'released':
      return context.version
        ? `Shipped in v${context.version} — does it work for you now?`
        : 'Shipped — does it work for you now?'
    case 'verified':
      return `Thanks for confirming — your report is marked verified.`
    case 'reopened':
      return `We reopened your report and are looking into it again.`
    case 'dismissed':
    case 'closed':
      return `Your report was reviewed and closed`
    case 'duplicate_linked':
      return "Same as an existing report — we'll update you there"
    case 'info_requested':
      return 'The developer asked you a question'
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

/** Drop the internal triage labels from a payload before it is stored or sent. */
export function sanitizeNotificationPayload<T extends Record<string, unknown>>(payload: T): Omit<T, 'category' | 'severity'> {
  const { category: _c, severity: _s, ...rest } = payload
  return rest
}

export interface ReporterPrefs {
  channels: ReporterChannelPrefs
  email: string | null
  emailVerifiedAt: string | null
  unsubscribedAt: string | null
  unsubscribeToken: string | null
}

export async function loadReporterPrefs(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
): Promise<ReporterPrefs> {
  const { data, error } = await db
    .from('reporter_notification_prefs')
    .select('channels, notification_email, email_verified_at, unsubscribed_at, unsubscribe_token')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', reporterTokenHash)
    .maybeSingle()
  // A read error falls back to in-app only: email / push are opt-in, so the
  // safe default is to not send them.
  if (error) notifLog.error('reporter_prefs_read_failed', { projectId, error: error.message })
  const row = (error ? null : data) as Record<string, unknown> | null

  const channels = {
    ...DEFAULT_CHANNEL_PREFS,
    ...((row?.channels as Partial<ReporterChannelPrefs> | null) ?? {}),
  }
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    channels,
    email: str(row?.notification_email),
    emailVerifiedAt: str(row?.email_verified_at),
    unsubscribedAt: str(row?.unsubscribed_at),
    unsubscribeToken: str(row?.unsubscribe_token),
  }
}

/** The project-level reporter-update controls (`project_settings.reporter_*`). */
export interface ProjectReporterSettings {
  mode: 'auto' | 'review'
  emailEnabled: boolean
  pushEnabled: boolean
  templates: Partial<Record<TemplatableType, string>>
  appName: string | null
  /** The settings row could not be read: mode reads 'review', both channels off. */
  readFailed: boolean
}

/**
 * On a read error the mode answers 'review' (a pipeline message waits in the
 * Outbox instead of going out against the operator's setting) and both
 * opt-in channels read as off. The error is logged loudly.
 */
export async function loadProjectReporterSettings(db: SupabaseClient, projectId: string): Promise<ProjectReporterSettings> {
  const [{ data, error }, { data: project }] = await Promise.all([
    db
      .from('project_settings')
      .select('reporter_updates_mode, reporter_email_enabled, reporter_push_enabled, reporter_templates')
      .eq('project_id', projectId)
      .maybeSingle(),
    db.from('projects').select('name').eq('id', projectId).maybeSingle(),
  ])
  const appName = typeof (project as { name?: unknown } | null)?.name === 'string' ? (project as { name: string }).name : null
  if (error) {
    notifLog.error('reporter_settings_read_failed', { projectId, error: error.message })
    return { mode: 'review', emailEnabled: false, pushEnabled: false, templates: {}, appName, readFailed: true }
  }
  const row = data as Record<string, unknown> | null
  return {
    mode: row?.reporter_updates_mode === 'review' ? 'review' : 'auto',
    emailEnabled: row?.reporter_email_enabled === true,
    pushEnabled: row?.reporter_push_enabled === true,
    templates: sanitizeTemplates(row?.reporter_templates),
    appName,
    readFailed: false,
  }
}

/** The project's `reporter_updates_mode` ('review' on a read error). */
export async function reporterUpdatesMode(db: SupabaseClient, projectId: string): Promise<'auto' | 'review'> {
  return (await loadProjectReporterSettings(db, projectId)).mode
}

type SlotClaim = { state: 'claimed'; id: string } | { state: 'done' } | { state: 'error' }

/**
 * Claim a delivery slot for (report, type, channel, dedupe_key). The unique
 * index over those columns makes the ledger idempotent. On a conflict (23505)
 * the existing row is loaded instead of giving up:
 *   - `sent` / `skipped` → terminal, `done` (idempotent no-op).
 *   - `pending` / `failed` → bump `attempts`, re-arm to `pending`, reuse the id
 *     so a previously-failed delivery can actually be retried.
 * The lookup filters on dedupe_key too (`is null` without one): several keyed
 * rows can share a (report, type, channel), and an unfiltered `maybeSingle`
 * would error on them and silently skip the delivery.
 */
async function claimDeliverySlot(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  reporterTokenHash: string,
  type: NotificationType,
  channel: NotificationChannel,
  payload: Record<string, unknown>,
  dedupeKey: string | null,
): Promise<SlotClaim> {
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
      dedupe_key: dedupeKey,
    })
    .select('id')
    .maybeSingle()

  if (!error && data?.id) return { state: 'claimed', id: data.id as string }

  if (!error || error.code !== '23505') {
    notifLog.error('delivery_claim_failed', { type, channel, error: error?.message ?? 'no row returned' })
    return { state: 'error' }
  }

  let lookup = db
    .from('notification_deliveries')
    .select('id, status, attempts')
    .eq('report_id', reportId)
    .eq('notification_type', type)
    .eq('channel', channel)
  lookup = dedupeKey === null ? lookup.is('dedupe_key', null) : lookup.eq('dedupe_key', dedupeKey)
  const { data: existing, error: selErr } = await lookup.maybeSingle()

  if (selErr || !existing) {
    notifLog.error('delivery_conflict_lookup_failed', { type, channel, error: selErr?.message ?? 'row vanished' })
    return { state: 'error' }
  }

  // Already delivered, deliberately skipped, or waiting for the digest →
  // idempotent no-op (a retry must not send a deferred email early).
  if (existing.status === 'sent' || existing.status === 'skipped' || existing.status === 'deferred') {
    return { state: 'done' }
  }

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
    return { state: 'error' }
  }
  return { state: 'claimed', id: existing.id as string }
}

/** Stamp a ledger row after the send has happened. A failed stamp is logged, never thrown. */
async function markDelivery(
  db: SupabaseClient,
  deliveryId: string,
  status: 'sent' | 'failed' | 'skipped' | 'deferred',
  errorMessage?: string,
): Promise<void> {
  try {
    const { error } = await db
      .from('notification_deliveries')
      .update({
        status,
        error_message: errorMessage ?? null,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
      })
      .eq('id', deliveryId)
    if (error) notifLog.error('delivery_stamp_failed', { deliveryId, status, error: error.message })
  } catch (err) {
    notifLog.error('delivery_stamp_failed', { deliveryId, status, error: String(err) })
  }
}

async function sendInAppNotification(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  reporterTokenHash: string,
  type: NotificationType,
  payload: Record<string, unknown>,
  dedupeKey: string | null,
): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  const { error } = await db.from('reporter_notifications').insert({
    project_id: projectId,
    report_id: reportId,
    reporter_token_hash: reporterTokenHash,
    notification_type: type,
    channel: 'in_app',
    payload,
    status: 'sent',
    dedupe_key: dedupeKey,
    sent_at: new Date().toISOString(),
  })
  if (error?.code === '23505') return { ok: true, duplicate: true }
  if (error) {
    notifLog.error('in_app_insert_failed', { type, error: error.message })
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** The in-app row another writer (the comment trigger, a release) already inserted. */
async function inAppRowExists(
  db: SupabaseClient,
  reportId: string,
  reporterTokenHash: string,
  type: NotificationType,
  dedupeKey: string | null,
): Promise<boolean> {
  let q = db
    .from('reporter_notifications')
    .select('id')
    .eq('report_id', reportId)
    .eq('reporter_token_hash', reporterTokenHash)
    .eq('notification_type', type)
    .eq('status', 'sent')
  q = dedupeKey === null ? q.is('dedupe_key', null) : q.eq('dedupe_key', dedupeKey)
  const { data, error } = await q.limit(1)
  if (error) {
    notifLog.error('in_app_row_lookup_failed', { type, error: error.message })
    return false
  }
  return (data ?? []).length > 0
}

/** Ledger outcome for one reporter email. */
type EmailOutcome = { status: 'sent' | 'failed' | 'skipped' | 'deferred'; reason?: string }

/** Emails / pushes this reporter was sent in the last 24 h (for the caps). */
async function sentInLastDay(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
  channel: 'email' | 'push',
): Promise<{ rows: Array<{ report_id: string }>; error: string | null }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await db
    .from('notification_deliveries')
    .select('report_id')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', reporterTokenHash)
    .eq('channel', channel)
    .eq('status', 'sent')
    .gte('sent_at', since)
    .limit(50)
  if (error) return { rows: [], error: error.message }
  return { rows: (data ?? []) as Array<{ report_id: string }>, error: null }
}

/** The reporter's unsubscribe token, minted (and stored) the first time it is needed. */
async function ensureUnsubscribeToken(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
  prefs: ReporterPrefs,
): Promise<string | null> {
  if (prefs.unsubscribeToken) return prefs.unsubscribeToken
  const token = mintEmailToken()
  const { error } = await db
    .from('reporter_notification_prefs')
    .update({ unsubscribe_token: token })
    .eq('project_id', projectId)
    .eq('reporter_token_hash', reporterTokenHash)
    .is('unsubscribe_token', null)
  if (error) {
    notifLog.error('unsubscribe_token_store_failed', { projectId, error: error.message })
    return null
  }
  prefs.unsubscribeToken = token
  return token
}

/** Title / summary of a report, for the email body. Null on any error. */
async function reportTitleFor(db: SupabaseClient, reportId: string): Promise<string | null> {
  const { data } = await db.from('reports').select('title, summary, description').eq('id', reportId).maybeSingle()
  const r = data as { title?: string | null; summary?: string | null; description?: string | null } | null
  const text = r?.title || r?.summary || r?.description || ''
  return text.trim() ? text.trim() : null
}

/**
 * Why an email to this reporter can not go out, checked in a fixed order so
 * the ledger reason is predictable: provider → project gate → address →
 * unsubscribe → verification. Null = sendable.
 */
export function emailBlockReason(
  prefs: Pick<ReporterPrefs, 'email' | 'emailVerifiedAt' | 'unsubscribedAt'>,
  settings: Pick<ProjectReporterSettings, 'emailEnabled'>,
): ChannelSkipReason | null {
  if (!emailProviderConfigured()) return 'not_configured'
  if (!settings.emailEnabled) return 'project_disabled'
  if (!prefs.email) return 'no_email'
  if (prefs.unsubscribedAt) return 'unsubscribed'
  if (!prefs.emailVerifiedAt) return 'unverified'
  return null
}

/**
 * One reporter email. Every outcome that is not a real send says why:
 * `skipped` with a reason, or `deferred` (over the cap → daily digest).
 * A provider that turns out unset at send time is `skipped not_configured`,
 * never `sent` or `failed`.
 */
async function deliverEmail(
  db: SupabaseClient,
  target: DeliveryTarget,
  ctx: DeliveryContext,
): Promise<EmailOutcome> {
  const block = emailBlockReason(ctx.prefs, ctx.settings)
  if (block) return { status: 'skipped', reason: block }

  const sent = await sentInLastDay(db, target.projectId, target.reporterTokenHash, 'email')
  if (sent.error) return { status: 'failed', reason: `cap_check_failed: ${sent.error}` }
  const cap = emailCapDecision(sent.rows.length, sent.rows.filter((r) => r.report_id === target.reportId).length)
  if (!cap.ok) return { status: 'deferred', reason: cap.reason }

  const token = await ensureUnsubscribeToken(db, target.projectId, target.reporterTokenHash, ctx.prefs)
  if (!token) return { status: 'failed', reason: 'unsubscribe_token_unavailable' }
  const email = buildReporterUpdateEmail({
    type: target.type,
    appName: ctx.settings.appName,
    reportTitle: await reportTitleFor(db, target.reportId),
    message: target.message,
    unsubscribeUrl: unsubscribeUrl(reporterEmailApiBase(), token),
  })
  const result = await sendTransactionalEmail({
    to: ctx.prefs.email as string,
    subject: email.subject,
    text: email.text,
    headers: email.headers,
    tags: { kind: 'reporter_update', type: target.type },
  })
  if (result.ok) return { status: 'sent' }
  if (result.reason === 'no_sender' || result.reason === 'no_api_key') return { status: 'skipped', reason: 'not_configured' }
  return { status: 'failed', reason: result.error }
}

interface ReporterPushRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Real Web Push over `reporter_push_subscriptions` (RFC 8030/8291/8292 via
 * `_shared/web-push.ts`). Every stored endpoint is re-checked against the push
 * service allow-list before any fetch, so a stored URL can never become an
 * SSRF target. Dead subscriptions (404/410) are deleted as a side effect.
 *
 * Result contract for the delivery ledger:
 *   - `ok: true`                      at least one device accepted the message
 *   - `error: 'push_not_configured'`  VAPID secrets unset          → skipped
 *   - `error: 'no_push_subscription'` reporter never subscribed    → skipped
 *   - any other error                 every device refused          → failed
 */
async function sendPushNotification(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
  message: string,
  appName: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!getVapidConfig()) return { ok: false, error: 'push_not_configured' }

  const { data, error } = await db
    .from('reporter_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', reporterTokenHash)
  if (error) {
    notifLog.error('push_subscriptions_load_failed', { error: error.message })
    return { ok: false, error: `db: ${error.message}` }
  }
  const rows = (data ?? []) as ReporterPushRow[]
  if (rows.length === 0) return { ok: false, error: 'no_push_subscription' }

  let sent = 0
  const errors: string[] = []
  for (const row of rows) {
    const result = await sendWebPushToSubscription(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      // The host app is who the reporter knows; Mushi stays out of the title.
      { title: appName?.trim() || 'Your report', body: message, tag: `reporter-${reporterTokenHash.slice(0, 12)}` },
    )
    if (result.ok) {
      sent++
      await db
        .from('reporter_push_subscriptions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', row.id)
      continue
    }
    errors.push(result.error)
    if (result.gone) {
      notifLog.info('push_subscription_gone', { id: row.id, status: result.status })
      await db.from('reporter_push_subscriptions').delete().eq('id', row.id)
    } else {
      notifLog.warn('push_delivery_failed', { id: row.id, status: result.status, error: result.error })
    }
  }

  if (sent > 0) return { ok: true }
  return { ok: false, error: errors[0] ?? 'push_failed' }
}

/** Ledger status for a push result — see `sendPushNotification` contract. */
function pushDeliveryStatus(result: { ok: boolean; error?: string }): 'sent' | 'failed' | 'skipped' {
  if (result.ok) return 'sent'
  if (result.error === 'push_not_configured' || result.error === 'no_push_subscription') return 'skipped'
  return 'failed'
}

interface DeliveryTarget {
  projectId: string
  reportId: string
  reporterTokenHash: string
  type: NotificationType
  payload: Record<string, unknown>
  message: string
  dedupeKey: string | null
}

/** The reporter's prefs and the project's controls, loaded once per notification. */
interface DeliveryContext {
  prefs: ReporterPrefs
  settings: ProjectReporterSettings
}

/** One reporter push, after the project gate and the daily cap. */
async function deliverPush(
  db: SupabaseClient,
  target: DeliveryTarget,
  ctx: DeliveryContext,
): Promise<{ status: 'sent' | 'failed' | 'skipped'; reason?: string }> {
  if (!ctx.settings.pushEnabled) return { status: 'skipped', reason: 'project_disabled' }
  const sent = await sentInLastDay(db, target.projectId, target.reporterTokenHash, 'push')
  if (sent.error) return { status: 'failed', reason: `cap_check_failed: ${sent.error}` }
  if (!pushCapAllows(sent.rows.length)) return { status: 'skipped', reason: 'capped' }
  const result = await sendPushNotification(db, target.projectId, target.reporterTokenHash, target.message, ctx.settings.appName)
  return { status: pushDeliveryStatus(result), reason: result.error }
}

/**
 * Deliver on each channel and stamp the ledger only after the send. With
 * `inAppAlreadyWritten`, the in-app row was inserted by another writer (the
 * comment trigger, a released Outbox row): it is verified to exist before
 * the ledger says `sent`, and never inserted a second time.
 */
async function deliverChannels(
  db: SupabaseClient,
  target: DeliveryTarget,
  channels: NotificationChannel[],
  ctx: DeliveryContext,
  inAppAlreadyWritten: boolean,
): Promise<NotificationResult> {
  const result = emptyResult()
  const { projectId, reportId, reporterTokenHash, type, payload, dedupeKey } = target

  for (const channel of channels) {
    const claim = await claimDeliverySlot(db, projectId, reportId, reporterTokenHash, type, channel, payload, dedupeKey)
    if (claim.state === 'done') {
      result.duplicate.push(channel)
      continue
    }
    if (claim.state === 'error') {
      result.failed.push(channel)
      continue
    }
    const deliveryId = claim.id

    if (channel === 'in_app') {
      if (inAppAlreadyWritten) {
        const exists = await inAppRowExists(db, reportId, reporterTokenHash, type, dedupeKey)
        await markDelivery(db, deliveryId, exists ? 'sent' : 'failed', exists ? undefined : 'in_app_row_missing')
        ;(exists ? result.delivered : result.failed).push('in_app')
        continue
      }
      const sent = await sendInAppNotification(db, projectId, reportId, reporterTokenHash, type, payload, dedupeKey)
      await markDelivery(db, deliveryId, sent.ok ? 'sent' : 'failed', sent.error)
      ;(sent.ok ? result.delivered : result.failed).push('in_app')
      continue
    }

    const outcome = channel === 'email' ? await deliverEmail(db, target, ctx) : await deliverPush(db, target, ctx)
    await markDelivery(db, deliveryId, outcome.status, outcome.reason)
    if (outcome.status === 'sent') result.delivered.push(channel)
    else if (outcome.status === 'skipped') result.skipped.push(channel)
    else if (outcome.status === 'deferred') result.deferred.push(channel)
    else result.failed.push(channel)
  }
  return result
}

/**
 * Channels to attempt. Email is attempted whenever the reporter asked for it
 * with an address, so a blocked send (provider unset, project gate off, not
 * verified, unsubscribed) still leaves a ledger row that says why. Push only
 * carries the four events worth a lock-screen alert (§4.3).
 */
function channelsFor(type: NotificationType, prefs: ReporterPrefs): NotificationChannel[] {
  // `in_app` defaults on (DEFAULT_CHANNEL_PREFS) but must be honoured when
  // explicitly disabled.
  const channels: NotificationChannel[] = []
  if (prefs.channels.in_app) channels.push('in_app')
  if (IN_APP_ONLY_TYPES.has(type)) return channels
  if (prefs.channels.email && prefs.email) channels.push('email')
  if (prefs.channels.push && PUSH_TYPES.has(type)) channels.push('push')
  return channels
}

/** Developer words and point awards are never replaced by a project template. */
const VERBATIM_TYPES: ReadonlySet<NotificationType> = new Set(['comment_reply', 'info_requested', 'points_awarded'])

/**
 * The project's wording for a pipeline message (`reporter_templates`), or
 * null to keep the built-in copy.
 */
function templatedMessage(type: NotificationType, payload: NotificationPayload, settings: ProjectReporterSettings): string | null {
  if (VERBATIM_TYPES.has(type)) return null
  const key = templateKeyFor(type)
  const template = key ? settings.templates[key] : undefined
  if (!template) return null
  const text = renderTemplate(template, { version: payload.version ?? null, app: settings.appName, n: payload.fixedCount ?? null })
  return text || null
}

/**
 * Fan-out a reporter notification across enabled channels.
 * Idempotent per (report_id, notification_type, channel, dedupe_key) via
 * notification_deliveries. In review mode a `reviewable` message is stored
 * `held` (no ledger rows, nothing sent) until an admin releases it. A project
 * template replaces pipeline copy at write time (`payload.templated`), so the
 * Outbox, the widget and the email all show the same words.
 */
export async function createNotification(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  reporterTokenHash: string,
  type: NotificationType,
  payload: NotificationPayload,
  options: CreateNotificationOptions = {},
): Promise<NotificationResult> {
  const settings = await loadProjectReporterSettings(db, projectId)
  const templated = templatedMessage(type, payload, settings)
  const message = templated ?? (payload.message || buildNotificationMessage(type, payload))
  const fullPayload: Record<string, unknown> = {
    ...sanitizeNotificationPayload(payload as unknown as Record<string, unknown>),
    message,
  }
  if (templated) fullPayload.templated = true
  const dedupeKey = options.dedupeKey ?? null

  if (options.reviewable && settings.mode === 'review') {
    const { error } = await db.from('reporter_notifications').insert({
      project_id: projectId,
      report_id: reportId,
      reporter_token_hash: reporterTokenHash,
      notification_type: type,
      channel: 'in_app',
      payload: fullPayload,
      status: 'held',
      dedupe_key: dedupeKey,
    })
    const result = emptyResult()
    if (error?.code === '23505') {
      result.duplicate.push('in_app')
      return result
    }
    if (error) {
      notifLog.error('held_insert_failed', { type, error: error.message })
      result.failed.push('in_app')
      return result
    }
    result.held = true
    return result
  }

  const prefs = await loadReporterPrefs(db, projectId, reporterTokenHash)
  return deliverChannels(
    db,
    { projectId, reportId, reporterTokenHash, type, payload: fullPayload, message, dedupeKey },
    channelsFor(type, prefs),
    { prefs, settings },
    false,
  )
}

/**
 * Email / push for an in-app row another writer already inserted (the
 * comment trigger's reply row). The in-app ledger row is stamped `sent` only
 * after that row is confirmed to exist.
 */
export async function deliverForExistingInAppRow(
  db: SupabaseClient,
  target: Omit<DeliveryTarget, 'message'> & { message?: string },
): Promise<NotificationResult> {
  const [prefs, settings] = await Promise.all([
    loadReporterPrefs(db, target.projectId, target.reporterTokenHash),
    loadProjectReporterSettings(db, target.projectId),
  ])
  const message = target.message || buildNotificationMessage(target.type, {})
  return deliverChannels(db, { ...target, message }, channelsFor(target.type, prefs), { prefs, settings }, true)
}

/** Dedupe key for a follower's copy of a canonical report's notification. */
export function followerDedupeKey(followerTokenHash: string, baseKey: string | null | undefined): string {
  return baseKey ? `f:${followerTokenHash}:${baseKey}` : `f:${followerTokenHash}`
}

/**
 * Send the same notification to every reporter following this report (their
 * own report was grouped under it or closed as its duplicate). Each follower
 * gets its own dedupe key, so their rows never collide with the owner's.
 */
export async function notifyFollowers(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  type: NotificationType,
  payload: NotificationPayload,
  options: CreateNotificationOptions = {},
): Promise<NotificationResult[]> {
  const { data, error } = await db
    .from('reporter_report_follows')
    .select('reporter_token_hash')
    .eq('report_id', reportId)
    .eq('project_id', projectId)
  if (error) {
    notifLog.error('followers_load_failed', { reportId, type, error: error.message })
    return []
  }
  const results: NotificationResult[] = []
  for (const row of (data ?? []) as Array<{ reporter_token_hash: string }>) {
    results.push(
      await createNotification(db, projectId, reportId, row.reporter_token_hash, type, payload, {
        ...options,
        dedupeKey: followerDedupeKey(row.reporter_token_hash, options.dedupeKey),
      }),
    )
  }
  return results
}

export type HeldActionResult =
  | { ok: true; result: NotificationResult; type?: NotificationType; dedupeKey?: string | null }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_HELD' | 'DB_ERROR'; message: string }

/**
 * Release a held Outbox message: flip it to `sent` (only if it is still held,
 * so two admins can not release it twice), then deliver email / push and
 * stamp the in-app ledger row.
 */
export async function releaseHeldNotification(
  db: SupabaseClient,
  input: { notificationId: string; projectId: string; releasedBy: string | null; bodyOverride?: string | null },
): Promise<HeldActionResult> {
  const patch: Record<string, unknown> = {
    status: 'sent',
    sent_at: new Date().toISOString(),
    released_at: new Date().toISOString(),
    released_by: input.releasedBy,
  }
  if (typeof input.bodyOverride === 'string') patch.body_override = input.bodyOverride
  const { data, error } = await db
    .from('reporter_notifications')
    .update(patch)
    .eq('id', input.notificationId)
    .eq('project_id', input.projectId)
    .eq('status', 'held')
    .select('id, report_id, reporter_token_hash, notification_type, payload, body_override, dedupe_key')
    .maybeSingle()
  if (error) return { ok: false, code: 'DB_ERROR', message: error.message }
  if (!data) return heldMissing(db, input.notificationId, input.projectId)

  const row = data as {
    report_id: string
    reporter_token_hash: string
    notification_type: NotificationType
    payload: Record<string, unknown> | null
    body_override: string | null
    dedupe_key: string | null
  }
  const message =
    row.body_override || (typeof row.payload?.message === 'string' ? (row.payload.message as string) : '')
  const result = await deliverForExistingInAppRow(db, {
    projectId: input.projectId,
    reportId: row.report_id,
    reporterTokenHash: row.reporter_token_hash,
    type: row.notification_type,
    payload: row.payload ?? {},
    message,
    dedupeKey: row.dedupe_key,
  })
  return { ok: true, result, type: row.notification_type, dedupeKey: row.dedupe_key }
}

/** Discard a held Outbox message; the reporter never sees it. */
export async function discardHeldNotification(
  db: SupabaseClient,
  input: { notificationId: string; projectId: string; discardedBy: string | null },
): Promise<HeldActionResult> {
  const { data, error } = await db
    .from('reporter_notifications')
    .update({ status: 'discarded', released_by: input.discardedBy, released_at: new Date().toISOString() })
    .eq('id', input.notificationId)
    .eq('project_id', input.projectId)
    .eq('status', 'held')
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, code: 'DB_ERROR', message: error.message }
  if (!data) return heldMissing(db, input.notificationId, input.projectId)
  return { ok: true, result: emptyResult() }
}

async function heldMissing(db: SupabaseClient, id: string, projectId: string): Promise<HeldActionResult> {
  const { data } = await db
    .from('reporter_notifications')
    .select('status')
    .eq('id', id)
    .eq('project_id', projectId)
    .maybeSingle()
  return data
    ? { ok: false, code: 'NOT_HELD', message: `Message is already ${(data as { status: string }).status}` }
    : { ok: false, code: 'NOT_FOUND', message: 'Message not found' }
}
