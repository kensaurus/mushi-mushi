/**
 * `_shared/slack-verify.ts` — the one Slack v0 signed-request verifier shared
 * by slack-interactions, the Events API route and the slash-command route.
 *
 * Signatures are produced with node:crypto (independent of the Web Crypto
 * implementation under test) so a regression in the base-string or hex
 * encoding cannot hide behind a symmetric bug.
 */

import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  verifySlackRequest,
  verifySlackSignature,
  computeSlackSignature,
  constantTimeEqual,
  SLACK_MAX_TIMESTAMP_DRIFT_S,
} from '../../supabase/functions/_shared/slack-verify.ts'

const SECRET = 'slack_signing_secret_test_only'
const BODY = 'payload=%7B%22type%22%3A%22block_actions%22%7D&token=abc'

function sign(ts: number, body = BODY, secret = SECRET): string {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')
}

describe('verifySlackRequest', () => {
  const now = 1_757_635_200 // fixed clock (2025-09-12)

  it('accepts a correctly signed request inside the window', async () => {
    const ts = now - 30
    const verdict = await verifySlackRequest({
      signingSecret: SECRET,
      timestamp: String(ts),
      rawBody: BODY,
      signature: sign(ts),
      nowSeconds: now,
    })
    expect(verdict).toEqual({ ok: true })
    expect(await verifySlackSignature({ signingSecret: SECRET, timestamp: String(ts), rawBody: BODY, signature: sign(ts), nowSeconds: now })).toBe(true)
  })

  it('matches the reference computation byte-for-byte', async () => {
    const ts = now
    expect(await computeSlackSignature(SECRET, String(ts), BODY)).toBe(sign(ts))
  })

  it('rejects a timestamp older than five minutes (replay window)', async () => {
    const ts = now - SLACK_MAX_TIMESTAMP_DRIFT_S - 1
    const verdict = await verifySlackRequest({
      signingSecret: SECRET,
      timestamp: String(ts),
      rawBody: BODY,
      signature: sign(ts),
      nowSeconds: now,
    })
    expect(verdict).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('rejects a timestamp too far in the future', async () => {
    const ts = now + SLACK_MAX_TIMESTAMP_DRIFT_S + 5
    const verdict = await verifySlackRequest({ signingSecret: SECRET, timestamp: String(ts), rawBody: BODY, signature: sign(ts), nowSeconds: now })
    expect(verdict).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('rejects a tampered body', async () => {
    const ts = now
    const verdict = await verifySlackRequest({
      signingSecret: SECRET,
      timestamp: String(ts),
      rawBody: BODY + '&extra=1',
      signature: sign(ts),
      nowSeconds: now,
    })
    expect(verdict).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a signature minted with another secret', async () => {
    const ts = now
    const verdict = await verifySlackRequest({
      signingSecret: SECRET,
      timestamp: String(ts),
      rawBody: BODY,
      signature: sign(ts, BODY, 'wrong-secret'),
      nowSeconds: now,
    })
    expect(verdict).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects missing headers and non-numeric timestamps', async () => {
    expect(await verifySlackRequest({ signingSecret: SECRET, timestamp: null, rawBody: BODY, signature: 'v0=abc', nowSeconds: now })).toEqual({ ok: false, reason: 'missing_headers' })
    expect(await verifySlackRequest({ signingSecret: SECRET, timestamp: String(now), rawBody: BODY, signature: undefined, nowSeconds: now })).toEqual({ ok: false, reason: 'missing_headers' })
    expect(await verifySlackRequest({ signingSecret: SECRET, timestamp: 'yesterday', rawBody: BODY, signature: 'v0=abc', nowSeconds: now })).toEqual({ ok: false, reason: 'bad_timestamp' })
  })

  it('rejects a signature of the wrong length without throwing', async () => {
    const verdict = await verifySlackRequest({ signingSecret: SECRET, timestamp: String(now), rawBody: BODY, signature: 'v0=deadbeef', nowSeconds: now })
    expect(verdict).toEqual({ ok: false, reason: 'bad_signature' })
  })
})

describe('constantTimeEqual', () => {
  it('compares equal and unequal strings', () => {
    expect(constantTimeEqual('v0=abc', 'v0=abc')).toBe(true)
    expect(constantTimeEqual('v0=abc', 'v0=abd')).toBe(false)
    expect(constantTimeEqual('v0=abc', 'v0=abcd')).toBe(false)
  })
})
