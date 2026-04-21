import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Slack request signing verification per
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * - 5-minute replay window enforced against the `X-Slack-Request-Timestamp`
 *   header.
 * - v0 = `v0:<timestamp>:<raw-body>` hashed with the Slack Signing Secret.
 * - Constant-time compare.
 */
export interface SlackVerifyInput {
  rawBody: string
  timestampHeader: string | undefined
  signatureHeader: string | undefined
  signingSecret: string
  /** Max skew in seconds. Default 300 (5 min) — matches Slack docs. */
  maxSkewSeconds?: number
}

export function verifySlackRequest(input: SlackVerifyInput): { ok: true } | { ok: false; reason: string } {
  if (!input.timestampHeader || !input.signatureHeader) return { ok: false, reason: 'missing_headers' }
  const ts = Number(input.timestampHeader)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts)
  if (skew > (input.maxSkewSeconds ?? 300)) return { ok: false, reason: 'stale_timestamp' }

  const basestring = `v0:${ts}:${input.rawBody}`
  const expected = `v0=${createHmac('sha256', input.signingSecret).update(basestring).digest('hex')}`

  const a = Buffer.from(expected)
  const b = Buffer.from(input.signatureHeader)
  if (a.length !== b.length) return { ok: false, reason: 'signature_mismatch' }
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'signature_mismatch' }
  return { ok: true }
}
