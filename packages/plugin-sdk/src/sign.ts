/**
 * HMAC signature verification for Mushi plugin webhooks.
 *
 * Supports two wire formats:
 *
 * 1. Legacy X-Mushi-Signature (Stripe-style):  `t=<unix-ms>,v1=<hex>`
 *    v1 = HMAC_SHA256(secret, `${t}.${rawBody}`).hex()
 *
 * 2. Standard Webhooks (https://www.standardwebhooks.com/):
 *    `webhook-id`:        unique message ID (same as X-Mushi-Delivery)
 *    `webhook-timestamp`: Unix seconds
 *    `webhook-signature`: `v1,<base64-hmac>`
 *    payload = `${webhook-id}.${webhook-timestamp}.${rawBody}`
 *
 * `verifySignature` does both signature and timestamp validation in constant
 * time so plugin authors don't accidentally implement a timing oracle.
 * `verifyStandardWebhooksSignature` covers the new standard format.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000

export interface VerifySignatureInput {
  /** Raw request body string. MUST be the exact bytes that were sent. */
  rawBody: string
  /** Header value of `X-Mushi-Signature`. */
  header: string | undefined | null
  /** Shared secret configured for this plugin in the Mushi admin UI. */
  secret: string
  /** Tolerance window for timestamp drift; defaults to 5 minutes. */
  toleranceMs?: number
  /** Override `Date.now()` for tests. */
  nowMs?: number
}

export type VerifyResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: 'missing_header' | 'malformed_header' | 'expired' | 'mismatch' }

export function verifySignature(input: VerifySignatureInput): VerifyResult {
  const { rawBody, header, secret } = input
  const tolerance = input.toleranceMs ?? DEFAULT_TOLERANCE_MS
  const now = input.nowMs ?? Date.now()

  if (!header) return { ok: false, reason: 'missing_header' }

  const parts = parseSignatureHeader(header)
  if (!parts) return { ok: false, reason: 'malformed_header' }

  const drift = Math.abs(now - parts.t)
  if (drift > tolerance) return { ok: false, reason: 'expired' }

  const expected = hmacHex(secret, `${parts.t}.${rawBody}`)
  if (!safeEqualHex(expected, parts.v1)) return { ok: false, reason: 'mismatch' }

  return { ok: true, timestamp: parts.t }
}

export function signPayload(secret: string, rawBody: string, timestampMs: number = Date.now()): string {
  const v1 = hmacHex(secret, `${timestampMs}.${rawBody}`)
  return `t=${timestampMs},v1=${v1}`
}

// ---------------------------------------------------------------------------
// Standard Webhooks support (https://www.standardwebhooks.com/)
// ---------------------------------------------------------------------------

export interface StandardWebhooksVerifyInput {
  /** Raw request body string. MUST be the exact bytes that were sent. */
  rawBody: string
  /** Header value of `webhook-id`. */
  webhookId: string | undefined | null
  /** Header value of `webhook-timestamp` (Unix seconds string). */
  webhookTimestamp: string | undefined | null
  /** Header value of `webhook-signature` (e.g. `v1,<base64>`). */
  webhookSignature: string | undefined | null
  /** Shared secret configured for this plugin in the Mushi admin UI. */
  secret: string
  /** Tolerance window for timestamp drift; defaults to 5 minutes. */
  toleranceSecs?: number
  /** Override `Date.now()` for tests (in milliseconds). */
  nowMs?: number
}

export function verifyStandardWebhooksSignature(
  input: StandardWebhooksVerifyInput,
): VerifyResult {
  const { rawBody, webhookId, webhookTimestamp, webhookSignature, secret } = input
  const toleranceSecs = input.toleranceSecs ?? 300
  const nowSecs = Math.floor((input.nowMs ?? Date.now()) / 1000)

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return { ok: false, reason: 'missing_header' }
  }

  const tsSecs = Number(webhookTimestamp)
  if (!Number.isFinite(tsSecs)) return { ok: false, reason: 'malformed_header' }
  if (Math.abs(nowSecs - tsSecs) > toleranceSecs) return { ok: false, reason: 'expired' }

  // The signature header may contain multiple space-separated v1,<sig> entries
  // (when a secret is rotated). Accept if any match.
  const candidates = webhookSignature.split(' ')
  const signedPayload = `${webhookId}.${webhookTimestamp}.${rawBody}`

  for (const candidate of candidates) {
    const prefix = candidate.slice(0, 3)
    const b64 = candidate.slice(3)
    if (prefix !== 'v1,') continue
    const expectedHex = hmacHex(secret, signedPayload)
    let candidateHex: string
    try {
      candidateHex = Buffer.from(b64, 'base64').toString('hex')
    } catch {
      continue
    }
    if (safeEqualHex(expectedHex, candidateHex)) {
      return { ok: true, timestamp: tsSecs * 1000 }
    }
  }

  return { ok: false, reason: 'mismatch' }
}

/**
 * Build Standard Webhooks headers for outbound webhook delivery.
 * Plugin servers can use this if they need to re-deliver events.
 */
export function buildStandardWebhooksHeaders(
  secret: string,
  rawBody: string,
  webhookId: string,
  timestampSecs: number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const payload = `${webhookId}.${timestampSecs}.${rawBody}`
  const hmacBytes = createHmac('sha256', secret).update(payload, 'utf8').digest()
  const sig = hmacBytes.toString('base64')
  return {
    'webhook-id': webhookId,
    'webhook-timestamp': String(timestampSecs),
    'webhook-signature': `v1,${sig}`,
  }
}

function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  let t: number | null = null
  let v1: string | null = null
  for (const part of header.split(',')) {
    const [k, v] = part.split('=')
    if (!k || !v) continue
    if (k.trim() === 't') {
      const parsed = Number(v.trim())
      if (Number.isFinite(parsed)) t = parsed
    } else if (k.trim() === 'v1') {
      v1 = v.trim()
    }
  }
  if (t === null || v1 === null) return null
  return { t, v1 }
}

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}
