/**
 * FILE: packages/server/supabase/functions/_shared/email.ts
 * PURPOSE: The one Resend call site. Every transactional email
 *          (reporter notifications, usage alerts, lifecycle emails) goes
 *          through sendTransactionalEmail() so the sender address, timeout,
 *          reply-to and custom headers (List-Unsubscribe) are handled once.
 *
 * Safe by default: never throws. When RESEND_FROM_EMAIL is unset the send is
 * skipped with `{ ok: false, reason: 'no_sender' }` — there is no fallback
 * sender any more (the old `noreply@mushi-mushi.dev` default was an unverified
 * domain and Resend rejected it). Set RESEND_FROM_EMAIL to a verified sender,
 * e.g. `Mushi Mushi <mushi@kensaur.us>`, before expecting any email out.
 *
 * ENVIRONMENT:
 * - RESEND_API_KEY     — required to send
 * - RESEND_FROM_EMAIL  — verified sender (display name allowed); required
 */

import { fetchWithTimeout } from './http.ts'
import { log } from './logger.ts'

const RESEND_API = 'https://api.resend.com/emails'
const elog = log.child('email')

export interface TransactionalEmail {
  to: string
  subject: string
  /** Plain-text body. At least one of text / html is required. */
  text?: string
  html?: string
  /** Extra SMTP headers, e.g. List-Unsubscribe / List-Unsubscribe-Post. */
  headers?: Record<string, string>
  replyTo?: string
  /** Free-form tags visible in the Resend dashboard (lifecycle key etc.). */
  tags?: Record<string, string>
}

export type SendEmailResult =
  | { ok: true; id: string | null }
  | {
      ok: false
      reason: 'no_sender' | 'no_api_key' | 'no_body' | 'http_error' | 'network_error'
      error: string
    }

/** Resolved sender, or null when RESEND_FROM_EMAIL is unset/blank. */
export function resolveSenderAddress(): string | null {
  const from = Deno.env.get('RESEND_FROM_EMAIL')?.trim()
  return from ? from : null
}

export async function sendTransactionalEmail(email: TransactionalEmail): Promise<SendEmailResult> {
  const from = resolveSenderAddress()
  if (!from) {
    elog.warn('RESEND_FROM_EMAIL not set — email skipped', { subject: email.subject })
    return { ok: false, reason: 'no_sender', error: 'RESEND_FROM_EMAIL not configured' }
  }
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    elog.warn('RESEND_API_KEY not set — email skipped', { subject: email.subject })
    return { ok: false, reason: 'no_api_key', error: 'RESEND_API_KEY not configured' }
  }
  if (!email.text && !email.html) {
    return { ok: false, reason: 'no_body', error: 'email needs text or html' }
  }

  const payload: Record<string, unknown> = {
    from,
    to: [email.to],
    subject: email.subject,
  }
  if (email.text) payload.text = email.text
  if (email.html) payload.html = email.html
  if (email.replyTo) payload.reply_to = email.replyTo
  if (email.headers && Object.keys(email.headers).length > 0) payload.headers = email.headers
  if (email.tags && Object.keys(email.tags).length > 0) {
    payload.tags = Object.entries(email.tags).map(([name, value]) => ({ name, value }))
  }

  try {
    const res = await fetchWithTimeout(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const error = `Resend ${res.status}: ${body.slice(0, 200)}`
      elog.warn('Resend API error', { status: res.status, subject: email.subject })
      return { ok: false, reason: 'http_error', error }
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, id: json?.id ?? null }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    elog.warn('Resend request failed', { subject: email.subject, err: error })
    return { ok: false, reason: 'network_error', error }
  }
}
