// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/_shared/slack-verify.ts
 * PURPOSE: One implementation of Slack's `v0` signed-request check, shared by
 *          every inbound Slack surface (slack-interactions, the Events API
 *          route and the slash-command route in `api`).
 *
 *          https://api.slack.com/authentication/verifying-requests-from-slack
 *
 *          signature = 'v0=' + hex(HMAC-SHA256(signing_secret,
 *                        'v0:' + X-Slack-Request-Timestamp + ':' + rawBody))
 *
 *          The timestamp must be within 5 minutes of now (replay window) and
 *          the comparison is constant-time. Callers MUST pass the raw request
 *          body exactly as received — re-serialising the parsed form or JSON
 *          changes byte order and breaks the MAC.
 *
 *          Dependency-free on purpose (Web Crypto only) so the vitest suite
 *          in `packages/server/src/__tests__` can import it under Node.
 */

export const SLACK_SIGNATURE_VERSION = 'v0'
export const SLACK_MAX_TIMESTAMP_DRIFT_S = 60 * 5

export interface SlackSignatureInput {
  signingSecret: string
  /** Raw `X-Slack-Request-Timestamp` header value (unix seconds as a string). */
  timestamp: string | null | undefined
  /** Raw request body, byte-for-byte as Slack sent it. */
  rawBody: string
  /** Raw `X-Slack-Signature` header value (`v0=<hex>`). */
  signature: string | null | undefined
  /** Injectable clock (unix seconds) for tests. */
  nowSeconds?: number
}

export type SlackSignatureVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'bad_timestamp' | 'stale_timestamp' | 'bad_signature' }

/** Constant-time string equality (same-length guard included). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Compute the expected `v0=<hex>` signature for a body + timestamp. */
export async function computeSlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const base = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base))
  return `${SLACK_SIGNATURE_VERSION}=${hex(mac)}`
}

/**
 * Full verdict variant — tells the caller *why* a request was rejected so
 * the audit row can record it. Never leaks into the HTTP response body.
 */
export async function verifySlackRequest(input: SlackSignatureInput): Promise<SlackSignatureVerdict> {
  if (!input.timestamp || !input.signature) return { ok: false, reason: 'missing_headers' }

  const ts = Number(input.timestamp)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > SLACK_MAX_TIMESTAMP_DRIFT_S) return { ok: false, reason: 'stale_timestamp' }

  const expected = await computeSlackSignature(input.signingSecret, input.timestamp, input.rawBody)
  return constantTimeEqual(expected, input.signature) ? { ok: true } : { ok: false, reason: 'bad_signature' }
}

/** Boolean variant — the historical `slack-interactions` signature. */
export async function verifySlackSignature(input: SlackSignatureInput): Promise<boolean> {
  return (await verifySlackRequest(input)).ok
}
