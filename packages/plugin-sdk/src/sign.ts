/**
 * HMAC signature verification for Mushi plugin webhooks.
 *
 * Format (Stripe-style):    `t=<unix-ms>,v1=<hex>`
 *
 * v1 = HMAC_SHA256(secret, `${t}.${rawBody}`).hex()
 *
 * `verifySignature` does both signature and timestamp validation in constant
 * time so plugin authors don't accidentally implement a timing oracle.
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
