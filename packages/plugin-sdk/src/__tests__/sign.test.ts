import { describe, it, expect } from 'vitest'
import { signPayload, verifySignature, DEFAULT_TOLERANCE_MS } from '../sign.js'

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
