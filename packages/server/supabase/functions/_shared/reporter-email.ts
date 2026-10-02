/**
 * FILE: _shared/reporter-email.ts
 * PURPOSE: Reporter email and push policy (Plan 018 §4.1, §4.3): the opt-in
 *          tokens, the frequency caps, the message copy, and the
 *          List-Unsubscribe headers.
 *
 * OVERVIEW:
 * - Pure module: no Deno globals at module scope, no I/O. The URL helper reads
 *   SUPABASE_URL inside the function, so `deno test` without permission flags
 *   can import this file.
 * - The host app is the data controller (docs/operators/reporter-data-processing.md),
 *   so every email names the host app, not Mushi.
 * - Email is a status notice about the reporter's own report: no promotion,
 *   ever. Adding marketing copy would bring it under 特定電子メール法.
 */

import type { NotificationType } from './notifications.ts'

/** At most this many reporter emails per reporter per rolling 24 h. */
export const EMAIL_MAX_PER_REPORTER_PER_DAY = 3
/** At most this many reporter emails per report per rolling 24 h. */
export const EMAIL_MAX_PER_REPORT_PER_DAY = 1
/** At most this many reporter pushes per reporter per rolling 24 h. */
export const PUSH_MAX_PER_REPORTER_PER_DAY = 2
/** A verification link stops working after this long. */
export const VERIFY_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** A new verification mail can be requested this often. */
export const VERIFY_RESEND_INTERVAL_MS = 60 * 1000

/** Only these reach a phone lock screen (§4.3). */
export const PUSH_TYPES: ReadonlySet<NotificationType> = new Set(['comment_reply', 'info_requested', 'released', 'fixed'])

/**
 * Why an email or push was not sent, as written to
 * `notification_deliveries.error_message`. The console counts these.
 */
export type ChannelSkipReason =
  | 'not_configured'
  | 'project_disabled'
  | 'unverified'
  | 'unsubscribed'
  | 'no_email'
  | 'capped'
  | 'push_not_configured'
  | 'no_push_subscription'

export type CapDecision = { ok: true } | { ok: false; reason: 'capped_daily' | 'capped_report' }

/** Email cap: `sentToday` across all reports, `sentForReport` for this one, both in the last 24 h. */
export function emailCapDecision(sentToday: number, sentForReport: number): CapDecision {
  if (sentForReport >= EMAIL_MAX_PER_REPORT_PER_DAY) return { ok: false, reason: 'capped_report' }
  if (sentToday >= EMAIL_MAX_PER_REPORTER_PER_DAY) return { ok: false, reason: 'capped_daily' }
  return { ok: true }
}

export function pushCapAllows(sentToday: number): boolean {
  return sentToday < PUSH_MAX_PER_REPORTER_PER_DAY
}

// ── Tokens ──────────────────────────────────────────────────────────────────

function base64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 32 random bytes, URL-safe. Used for the verify and unsubscribe links. */
export function mintEmailToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/

export function isWellFormedEmailToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token)
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Addresses ───────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** Trimmed, lower-cased address, or null when it is not a plausible email. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (email.length > 254 || !EMAIL_RE.test(email)) return null
  return email
}

/** "ke***@example.com" — what GET /notification-prefs returns. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const local = email.slice(0, at)
  return `${local.slice(0, Math.min(2, local.length))}***${email.slice(at)}`
}

// ── Links ───────────────────────────────────────────────────────────────────

/** Public API base the email links point at. */
export function reporterEmailApiBase(): string {
  // Read through globalThis so the vitest (Node) suite can import this module.
  const env = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno?.env
  const supabase = (env?.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
  return `${supabase}/functions/v1/api`
}

export function verifyUrl(apiBase: string, token: string): string {
  return `${apiBase}/v1/public/reporter/email/verify?t=${encodeURIComponent(token)}`
}

export function unsubscribeUrl(apiBase: string, token: string): string {
  return `${apiBase}/v1/public/reporter/email/unsubscribe?t=${encodeURIComponent(token)}`
}

/** RFC 8058 one-click headers. Mail clients POST `List-Unsubscribe=One-Click` to the URL. */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

// ── Copy ────────────────────────────────────────────────────────────────────

export interface BuiltEmail {
  subject: string
  text: string
  headers: Record<string, string>
}

function appLabel(appName: string | null | undefined): string {
  const name = (appName ?? '').replace(/[\r\n]+/g, ' ').trim()
  return name ? name.slice(0, 80) : 'the app'
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const SUBJECTS: Partial<Record<NotificationType, string>> = {
  comment_reply: 'The developer replied to your report',
  info_requested: 'The developer has a question about your report',
  fixed: 'Your report is fixed',
  released: 'The fix for your report has shipped',
  verified: 'Thanks for confirming the fix',
  reopened: 'Your report was reopened',
  dismissed: 'Your report was closed',
  closed: 'Your report was closed',
}

const FOOTER = (app: string, unsub: string) =>
  `You get this because you asked ${app} for updates on a report you sent.\n` +
  `Stop these emails: ${unsub}`

/** One status update about one report. */
export function buildReporterUpdateEmail(input: {
  type: NotificationType
  appName: string | null
  reportTitle: string | null
  message: string
  unsubscribeUrl: string
}): BuiltEmail {
  const app = appLabel(input.appName)
  const subject = `${app}: ${SUBJECTS[input.type] ?? 'An update on your report'}`
  const title = input.reportTitle ? `Your report: "${clip(input.reportTitle, 120)}"\n\n` : ''
  const text =
    `${title}${clip(input.message, 2000)}\n\n` +
    `Open ${app} and look in "Your reports" to reply.\n\n` +
    `--\n${FOOTER(app, input.unsubscribeUrl)}\n`
  return { subject, text, headers: listUnsubscribeHeaders(input.unsubscribeUrl) }
}

/** The daily digest: updates that were held back by the frequency cap. */
export function buildReporterDigestEmail(input: {
  appName: string | null
  items: Array<{ reportTitle: string | null; message: string }>
  unsubscribeUrl: string
}): BuiltEmail {
  const app = appLabel(input.appName)
  const n = input.items.length
  const subject = `${app}: ${n === 1 ? '1 update' : `${n} updates`} on your reports`
  const lines = input.items.map((it) => {
    const title = it.reportTitle ? `"${clip(it.reportTitle, 80)}": ` : ''
    return `- ${title}${clip(it.message, 300)}`
  })
  const text =
    `Here is what changed on your reports today.\n\n${lines.join('\n')}\n\n` +
    `Open ${app} and look in "Your reports" for details.\n\n` +
    `--\n${FOOTER(app, input.unsubscribeUrl)}\n`
  return { subject, text, headers: listUnsubscribeHeaders(input.unsubscribeUrl) }
}

/** Double opt-in: the only mail sent before the address is confirmed. */
export function buildVerifyEmail(input: { appName: string | null; confirmUrl: string }): Omit<BuiltEmail, 'headers'> {
  const app = appLabel(input.appName)
  return {
    subject: `${app}: confirm your email for report updates`,
    text:
      `You asked ${app} to email you when a report you sent gets an update.\n\n` +
      `Confirm this address: ${input.confirmUrl}\n\n` +
      `The link works for 7 days. If you did not ask for this, ignore this email — ` +
      `nothing is sent until you confirm.\n`,
  }
}

// ── Templates (project_settings.reporter_templates) ─────────────────────────

/** Pipeline messages a project may reword. Developer replies are never templated. */
export const TEMPLATABLE_TYPES = ['reviewing', 'fix_started', 'fixed', 'released', 'closed', 'duplicate_linked'] as const
export type TemplatableType = (typeof TEMPLATABLE_TYPES)[number]
export const TEMPLATE_MAX_CHARS = 280
const ALLOWED_PLACEHOLDERS = new Set(['version', 'app', 'n'])

/** The template key a notification type reads. */
export function templateKeyFor(type: NotificationType): TemplatableType | null {
  switch (type) {
    case 'classified':
    case 'reviewing':
      return 'reviewing'
    case 'confirmed':
    case 'fix_started':
      return 'fix_started'
    case 'fixed':
      return 'fixed'
    case 'released':
      return 'released'
    case 'dismissed':
    case 'closed':
      return 'closed'
    case 'duplicate_linked':
      return 'duplicate_linked'
    default:
      return null
  }
}

/** Validation error for one template, or null when it is acceptable. */
export function templateError(text: unknown): string | null {
  if (typeof text !== 'string') return 'must be text'
  const trimmed = text.trim()
  if (!trimmed) return 'must not be empty'
  if (trimmed.length > TEMPLATE_MAX_CHARS) return `must be ${TEMPLATE_MAX_CHARS} characters or fewer`
  for (const m of trimmed.matchAll(/\{([^{}]*)\}/g)) {
    if (!ALLOWED_PLACEHOLDERS.has(m[1])) return `unknown placeholder {${m[1]}} — use {version}, {app} or {n}`
  }
  return null
}

/**
 * Fill a stored template. `{n}` is the number of reports a release fixed;
 * it is never a count of other reporters (Plan 018 §2.1).
 */
export function renderTemplate(template: string, params: { version?: string | null; app?: string | null; n?: number | null }): string {
  return template
    .replace(/\{version\}/g, params.version ?? '')
    .replace(/\{app\}/g, appLabel(params.app))
    .replace(/\{n\}/g, params.n != null ? String(params.n) : '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Templates as stored, restricted to known keys with valid text. */
export function sanitizeTemplates(raw: unknown): Partial<Record<TemplatableType, string>> {
  const out: Partial<Record<TemplatableType, string>> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of TEMPLATABLE_TYPES) {
    const v = (raw as Record<string, unknown>)[key]
    if (typeof v === 'string' && templateError(v) === null) out[key] = v.trim()
  }
  return out
}
