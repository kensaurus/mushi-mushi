/**
 * FILE: sentry-webhook-verify.test.ts
 * PURPOSE: Pin how an inbound Sentry integration-platform delivery is
 *          verified: header names, HMAC, timestamp window, replay keys, and
 *          that both Sentry routes read the secret out of Vault.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const mod = await import('../../supabase/functions/_shared/sentry-webhook-verify.ts')

const SECRET = 'whsec-test-secret'
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)
const BODY = JSON.stringify({ action: 'created', data: { issue: { id: '123', title: 'TypeError' } } })

const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body, 'utf8').digest('hex')

function headers(over: Partial<Record<string, string>> = {}) {
  const h: Record<string, string> = {
    'Sentry-Hook-Signature': sign(BODY),
    'Request-ID': 'req-1',
    'Sentry-Hook-Timestamp': String(Math.floor(NOW / 1000)),
    'Sentry-Hook-Resource': 'issue',
    ...over,
  }
  return mod.readSentryHookHeaders((name) => h[name])
}

const neverSeen = { isReplay: async () => false }

describe('readSentryHookHeaders', () => {
  it('reads the documented Sentry header names', () => {
    const h = headers()
    expect(h.signature).toBe(sign(BODY))
    expect(h.requestId).toBe('req-1')
    expect(h.timestamp).toBe(String(Math.floor(NOW / 1000)))
  })

  it('falls back to X-Sentry-Hook-Signature when the documented one is absent', () => {
    const h = mod.readSentryHookHeaders((name) =>
      name === 'X-Sentry-Hook-Signature' ? 'abc' : undefined,
    )
    expect(h.signature).toBe('abc')
    expect(h.requestId).toBeNull()
  })
})

describe('parseSentryHookTimestamp', () => {
  it('accepts seconds and milliseconds', () => {
    expect(mod.parseSentryHookTimestamp('1759406400')).toBe(1759406400000)
    expect(mod.parseSentryHookTimestamp('1759406400123')).toBe(1759406400123)
  })
  it('rejects junk', () => {
    expect(mod.parseSentryHookTimestamp(null)).toBeNull()
    expect(mod.parseSentryHookTimestamp('yesterday')).toBeNull()
    expect(mod.parseSentryHookTimestamp('-5')).toBeNull()
  })
})

describe('verifySentryDelivery', () => {
  it('accepts a valid signed, fresh, unseen delivery', async () => {
    const v = await mod.verifySentryDelivery(
      { headers: headers(), body: BODY, secret: SECRET, nowMs: NOW },
      neverSeen,
    )
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.requestId).toBe('req-1')
      expect(v.bodyHash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('accepts a millisecond timestamp inside the window', async () => {
    const v = await mod.verifySentryDelivery(
      { headers: headers({ 'Sentry-Hook-Timestamp': String(NOW - 60_000) }), body: BODY, secret: SECRET, nowMs: NOW },
      neverSeen,
    )
    expect(v.ok).toBe(true)
  })

  it('rejects a bad signature', async () => {
    const v = await mod.verifySentryDelivery(
      { headers: headers({ 'Sentry-Hook-Signature': sign(BODY, 'wrong-secret') }), body: BODY, secret: SECRET, nowMs: NOW },
      neverSeen,
    )
    expect(v).toMatchObject({ ok: false, status: 401, code: 'INVALID_SIGNATURE', auditOutcome: 'rejected_signature' })
  })

  it('rejects a body that was altered after signing', async () => {
    const v = await mod.verifySentryDelivery(
      { headers: headers(), body: BODY.replace('TypeError', 'RangeError'), secret: SECRET, nowMs: NOW },
      neverSeen,
    )
    expect(v).toMatchObject({ ok: false, code: 'INVALID_SIGNATURE' })
  })

  it('rejects a missing signature', async () => {
    const h = mod.readSentryHookHeaders((name) => (name === 'Request-ID' ? 'req-1' : undefined))
    const v = await mod.verifySentryDelivery({ headers: h, body: BODY, secret: SECRET, nowMs: NOW }, neverSeen)
    expect(v).toMatchObject({ ok: false, status: 401, code: 'MISSING_SIGNATURE' })
  })

  it('rejects when no secret is readable (missing or unreadable Vault ref)', async () => {
    const v = await mod.verifySentryDelivery({ headers: headers(), body: BODY, secret: null, nowMs: NOW }, neverSeen)
    expect(v).toMatchObject({ ok: false, status: 403, code: 'NO_SECRET', auditOutcome: 'error' })
  })

  it('does not treat a vault:// ref string as the key', async () => {
    const v = await mod.verifySentryDelivery(
      { headers: headers(), body: BODY, secret: 'vault://mushi/integration/p/sentry/sentry_webhook_secret', nowMs: NOW },
      neverSeen,
    )
    expect(v).toMatchObject({ ok: false, code: 'INVALID_SIGNATURE' })
  })

  it('rejects a stale timestamp', async () => {
    const stale = String(Math.floor((NOW - (mod.SENTRY_HOOK_MAX_SKEW_SEC + 1) * 1000) / 1000))
    const v = await mod.verifySentryDelivery(
      { headers: headers({ 'Sentry-Hook-Timestamp': stale }), body: BODY, secret: SECRET, nowMs: NOW },
      neverSeen,
    )
    expect(v).toMatchObject({ ok: false, status: 401, code: 'STALE_TIMESTAMP' })
  })

  it('rejects a far-future timestamp', async () => {
    const future = String(Math.floor((NOW + 3_600_000) / 1000))
    const v = await mod.verifySentryDelivery(
      { headers: headers({ 'Sentry-Hook-Timestamp': future }), body: BODY, secret: SECRET, nowMs: NOW },
      neverSeen,
    )
    expect(v).toMatchObject({ ok: false, code: 'STALE_TIMESTAMP' })
  })

  it('rejects a missing timestamp', async () => {
    const h = { ...headers(), timestamp: null }
    const v = await mod.verifySentryDelivery({ headers: h, body: BODY, secret: SECRET, nowMs: NOW }, neverSeen)
    expect(v).toMatchObject({ ok: false, status: 401, code: 'MISSING_TIMESTAMP' })
  })

  it('rejects a replayed Request-ID', async () => {
    const seen = new Set(['req-1'])
    const v = await mod.verifySentryDelivery(
      { headers: headers(), body: BODY, secret: SECRET, nowMs: NOW },
      { isReplay: async ({ requestId }) => requestId !== null && seen.has(requestId) },
    )
    expect(v).toMatchObject({ ok: false, status: 409, code: 'DUPLICATE', auditOutcome: 'rejected_replay' })
  })

  it('rejects a replayed body under a fresh Request-ID', async () => {
    const first = await mod.verifySentryDelivery(
      { headers: headers(), body: BODY, secret: SECRET, nowMs: NOW },
      neverSeen,
    )
    expect(first.ok).toBe(true)
    const acceptedHash = first.ok ? first.bodyHash : ''
    const v = await mod.verifySentryDelivery(
      { headers: headers({ 'Request-ID': 'req-2' }), body: BODY, secret: SECRET, nowMs: NOW },
      { isReplay: async ({ bodyHash }) => bodyHash === acceptedHash },
    )
    expect(v).toMatchObject({ ok: false, code: 'DUPLICATE' })
  })

  it('only consults the replay store for authentic deliveries', async () => {
    let calls = 0
    await mod.verifySentryDelivery(
      { headers: headers({ 'Sentry-Hook-Signature': 'deadbeef' }), body: BODY, secret: SECRET, nowMs: NOW },
      { isReplay: async () => { calls++; return false } },
    )
    expect(calls).toBe(0)
  })
})

describe('Sentry webhook routes (source shape)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(resolve(here, '../../supabase/functions/api/routes/public.ts'), 'utf8')
  const sentryRoute = src.slice(
    src.indexOf("app.post('/v1/webhooks/sentry',"),
    src.indexOf("app.post('/v1/webhooks/sentry/seer',"),
  )
  const seerStart = src.indexOf("app.post('/v1/webhooks/sentry/seer',")
  const seerRoute = src.slice(seerStart, src.indexOf('app.post(', seerStart + 10))

  it('verifies through the shared helper with Vault-read secret and both replay keys', () => {
    expect(sentryRoute).toContain('readSentryHookHeaders(')
    expect(sentryRoute).toContain('verifySentryDelivery(')
    expect(sentryRoute).toContain('dereferenceMaybeVault(')
    expect(sentryRoute).toContain('hasAcceptedDuplicate(')
    expect(sentryRoute).not.toMatch(/Sentry-Hook-Resource-Id/)
  })

  it('the seer route runs the same verification as the main route', () => {
    expect(seerRoute).toContain("createWebhookMiddleware('sentry_seer')")
    expect(seerRoute).toContain('readSentryHookHeaders(')
    expect(seerRoute).toContain('dereferenceMaybeVault(')
    expect(seerRoute).toContain('hasAcceptedDuplicate(')
    expect(seerRoute).not.toContain('verifySentryHookSignature')
    // The module path must resolve from api/routes/.
    expect(seerRoute).toContain("'../../_shared/seer.ts'")
  })

  it('the seer route verifies before it reads the enabled flag or the body', () => {
    const verifyAt = seerRoute.indexOf('verifySentryDelivery(')
    expect(verifyAt).toBeGreaterThan(-1)
    expect(seerRoute.indexOf('sentry_seer_enabled) {')).toBeGreaterThan(verifyAt)
    expect(seerRoute.indexOf('JSON.parse(rawBody)')).toBeGreaterThan(verifyAt)
  })

  it('every seer response after verification resolves the audit row', () => {
    const afterVerdict = seerRoute.slice(seerRoute.indexOf('if (!verdict.ok) {'))
    const tail = afterVerdict.slice(afterVerdict.indexOf('verdict.status);') + 1)
    expect(tail).not.toMatch(/return c\.json\(/)
    expect((tail.match(/return done\(/g) ?? []).length).toBeGreaterThanOrEqual(5)
  })
})
