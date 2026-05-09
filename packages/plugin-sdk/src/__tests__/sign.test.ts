import { describe, it, expect } from 'vitest'
import {
  signPayload,
  verifySignature,
  DEFAULT_TOLERANCE_MS,
  buildStandardWebhooksHeaders,
  verifyStandardWebhooksSignature,
} from '../sign.js'

const SECRET = 'plugin-test-secret'

describe('signPayload + verifySignature', () => {
  it('round-trips a valid signature', () => {
    const body = JSON.stringify({ event: 'report.created', deliveryId: 'd-1' })
    const t = 1_700_000_000_000
    const header = signPayload(SECRET, body, t)
    const result = verifySignature({ rawBody: body, header, secret: SECRET, nowMs: t })
    expect(result).toEqual({ ok: true, timestamp: t })
  })

  it('rejects a tampered body', () => {
    const t = 1_700_000_000_000
    const header = signPayload(SECRET, 'a', t)
    const result = verifySignature({ rawBody: 'b', header, secret: SECRET, nowMs: t })
    expect(result).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('rejects an expired timestamp', () => {
    const t = 1_700_000_000_000
    const header = signPayload(SECRET, 'a', t)
    const result = verifySignature({ rawBody: 'a', header, secret: SECRET, nowMs: t + DEFAULT_TOLERANCE_MS + 1 })
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a missing header', () => {
    const result = verifySignature({ rawBody: 'a', header: undefined, secret: SECRET })
    expect(result).toEqual({ ok: false, reason: 'missing_header' })
  })

  it('rejects a malformed header', () => {
    const result = verifySignature({ rawBody: 'a', header: 'not-a-signature', secret: SECRET })
    expect(result).toEqual({ ok: false, reason: 'malformed_header' })
  })
})

describe('Standard Webhooks (build + verify)', () => {
  const body = JSON.stringify({ event: 'report.created', deliveryId: 'd-std-1' })
  const t = 1_700_000_000_000
  const tSecs = Math.floor(t / 1000)

  it('round-trips a valid Standard Webhooks signature', () => {
    const headers = buildStandardWebhooksHeaders(SECRET, body, 'd-std-1', tSecs)
    const result = verifyStandardWebhooksSignature({
      rawBody: body,
      webhookId: headers['webhook-id'],
      webhookTimestamp: headers['webhook-timestamp'],
      webhookSignature: headers['webhook-signature'],
      secret: SECRET,
      nowMs: t,
    })
    expect(result).toEqual({ ok: true, timestamp: tSecs * 1000 })
  })

  it('rejects a tampered body under Standard Webhooks', () => {
    const headers = buildStandardWebhooksHeaders(SECRET, body, 'd-std-2', tSecs)
    const result = verifyStandardWebhooksSignature({
      rawBody: body + 'x',
      webhookId: headers['webhook-id'],
      webhookTimestamp: headers['webhook-timestamp'],
      webhookSignature: headers['webhook-signature'],
      secret: SECRET,
      nowMs: t,
    })
    expect(result).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('rejects an expired Standard Webhooks timestamp', () => {
    const headers = buildStandardWebhooksHeaders(SECRET, body, 'd-std-3', tSecs)
    const result = verifyStandardWebhooksSignature({
      rawBody: body,
      webhookId: headers['webhook-id'],
      webhookTimestamp: headers['webhook-timestamp'],
      webhookSignature: headers['webhook-signature'],
      secret: SECRET,
      nowMs: t + DEFAULT_TOLERANCE_MS + 1000,
    })
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects when any Standard Webhooks header is missing', () => {
    const result = verifyStandardWebhooksSignature({
      rawBody: body,
      webhookId: 'd-std-4',
      webhookTimestamp: undefined,
      webhookSignature: 'v1,abc',
      secret: SECRET,
    })
    expect(result).toEqual({ ok: false, reason: 'missing_header' })
  })

  it('rejects a malformed Standard Webhooks signature header', () => {
    const result = verifyStandardWebhooksSignature({
      rawBody: body,
      webhookId: 'd-std-5',
      webhookTimestamp: String(tSecs),
      webhookSignature: 'no-version-prefix',
      secret: SECRET,
      nowMs: t,
    })
    expect(result).toEqual({ ok: false, reason: 'mismatch' })
  })
})
