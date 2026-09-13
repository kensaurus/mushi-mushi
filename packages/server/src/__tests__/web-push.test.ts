/**
 * `_shared/web-push.ts` — RFC 8291 aes128gcm + RFC 8292 VAPID sender.
 *
 * Covers: the push-service host allow-list (SSRF guard), VAPID key parsing
 * (scalar + JWK forms), a full encrypt → decrypt round-trip using an
 * independent user-agent side implementation of RFC 8291 / RFC 8188, VAPID
 * JWT verification against the public key, the not-configured path, and the
 * per-subscription bookkeeping in `sendWebPushToUser` (201 → success stamp,
 * 410 → row deleted, 5xx → failure_count, disallowed host → never fetched).
 *
 * Web Crypto is the same API in Node 22 and Deno, so the suite exercises the
 * real cryptography rather than mocking it.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

type WebPush = typeof import('../../supabase/functions/_shared/web-push.ts')
let wp: WebPush

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  wp = await import('../../supabase/functions/_shared/web-push.ts')
})

// ── helpers ──────────────────────────────────────────────────────────────────

const utf8 = new TextEncoder()

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}
function fromB64u(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'))
}
function buf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

async function makeVapid(subject = 'mailto:push@example.test') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return {
    cfg: { publicKey: b64u(pub), privateKey: jwk.d as string, subject },
    jwk,
    publicKey: pair.publicKey,
  }
}

/** A browser-side subscription: ECDH key pair + 16-byte auth secret. */
async function makeUserAgent() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { pair, pub, auth, keys: { p256dh: b64u(pub), auth: b64u(auth) } }
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, key, len * 8),
  )
}

/** Independent RFC 8291 receiver: decrypts an aes128gcm body with the UA private key. */
async function uaDecrypt(body: Uint8Array, ua: Awaited<ReturnType<typeof makeUserAgent>>): Promise<string> {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16, false)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const ciphertext = body.slice(21 + idlen)
  expect(rs).toBe(4096)
  expect(idlen).toBe(65)

  const asKey = await crypto.subtle.importKey('raw', buf(asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.pair.privateKey, 256))
  const keyInfo = new Uint8Array([...utf8.encode('WebPush: info\0'), ...ua.pub, ...asPublic])
  const ikm = await hkdf(ua.auth, secret, keyInfo, 32)
  const cek = await hkdf(salt, ikm, utf8.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8.encode('Content-Encoding: nonce\0'), 12)
  const aes = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['decrypt'])
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(nonce) }, aes, buf(ciphertext)))
  // Final record: plaintext || 0x02 || zero padding
  let end = record.length - 1
  while (end >= 0 && record[end] === 0) end--
  expect(record[end]).toBe(0x02)
  return new TextDecoder().decode(record.slice(0, end))
}

const SUB_FCM = 'https://fcm.googleapis.com/fcm/send/abc123'
const SUB_MOZ = 'https://updates.push.services.mozilla.com/wpush/v2/xyz'
const SUB_APPLE = 'https://web.push.apple.com/QWERTY'
const SUB_WNS = 'https://db5p.notify.windows.com/w/?token=abc'

// ── allow-list ───────────────────────────────────────────────────────────────

describe('isAllowedPushEndpoint', () => {
  it('accepts the four browser push services over https', () => {
    for (const url of [SUB_FCM, SUB_MOZ, SUB_APPLE, SUB_WNS]) expect(wp.isAllowedPushEndpoint(url)).toBe(true)
  })

  it('rejects anything else (SSRF guard)', () => {
    const bad = [
      'http://fcm.googleapis.com/fcm/send/x', // plain http
      'https://fcm.googleapis.com.evil.test/x', // suffix spoof
      'https://evilpush.services.mozilla.com/x', // missing dot boundary
      'https://push.apple.com/x', // bare suffix domain
      'https://169.254.169.254/latest/meta-data', // cloud metadata
      'https://localhost/', 'https://internal.corp/', 'not a url', '',
      'https://user:pw@fcm.googleapis.com/x', // credentials
      'https://fcm.googleapis.com:8443/x', // odd port
    ]
    for (const url of bad) expect(wp.isAllowedPushEndpoint(url), url).toBe(false)
  })
})

// ── key handling ─────────────────────────────────────────────────────────────

describe('parseVapidKeys', () => {
  it('accepts the base64url scalar form and yields an importable JWK', async () => {
    const { cfg } = await makeVapid()
    const material = wp.parseVapidKeys(cfg)
    expect(material.publicRaw.length).toBe(65)
    expect(material.jwk.d).toBe(cfg.privateKey)
    const imported = await crypto.subtle.importKey('jwk', material.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    expect(imported.type).toBe('private')
  })

  it('accepts a JSON JWK private key and rejects a mismatched one', async () => {
    const { cfg, jwk } = await makeVapid()
    const other = await makeVapid()
    expect(wp.parseVapidKeys({ ...cfg, privateKey: JSON.stringify(jwk) }).jwk.d).toBe(jwk.d)
    expect(() => wp.parseVapidKeys({ ...cfg, privateKey: JSON.stringify(other.jwk) })).toThrow(/does not match/)
  })

  it('rejects malformed keys', async () => {
    const { cfg } = await makeVapid()
    expect(() => wp.parseVapidKeys({ ...cfg, publicKey: 'AAAA' })).toThrow(/VAPID_PUBLIC_KEY/)
    expect(() => wp.parseVapidKeys({ ...cfg, privateKey: 'AAAA' })).toThrow(/VAPID_PRIVATE_KEY/)
    expect(() => wp.parseVapidKeys({ ...cfg, privateKey: '{not json' })).toThrow(/JSON/)
  })
})

describe('getVapidConfig', () => {
  it('returns null unless all three secrets are set', () => {
    const prev = { ...process.env }
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    delete process.env.VAPID_SUBJECT
    expect(wp.getVapidConfig()).toBeNull()
    process.env.VAPID_PUBLIC_KEY = 'pub'
    process.env.VAPID_PRIVATE_KEY = 'priv'
    expect(wp.getVapidConfig()).toBeNull()
    process.env.VAPID_SUBJECT = 'mailto:a@b.c'
    expect(wp.getVapidConfig()).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' })
    process.env = prev
  })
})

// ── encryption + VAPID ───────────────────────────────────────────────────────

describe('buildWebPushRequest', () => {
  it('produces an aes128gcm body the user agent can decrypt, and a verifiable VAPID JWT', async () => {
    const vapid = await makeVapid('mailto:ops@example.test')
    const ua = await makeUserAgent()
    const payload = { title: 'Draft PR ready', body: 'ログインボタン修正 → #42', url: 'https://github.com/o/r/pull/42', tag: 'voice-1' }
    const nowSec = 1_800_000_000

    const req = await wp.buildWebPushRequest({
      subscription: { endpoint: SUB_FCM, keys: ua.keys },
      payload,
      vapid: vapid.cfg,
      ttl: 3600,
      urgency: 'high',
      topic: 'voice-return',
      nowSec,
    })

    expect(req.endpoint).toBe(SUB_FCM)
    expect(req.headers['Content-Encoding']).toBe('aes128gcm')
    expect(req.headers['Content-Type']).toBe('application/octet-stream')
    expect(req.headers.TTL).toBe('3600')
    expect(req.headers.Urgency).toBe('high')
    expect(req.headers.Topic).toBe('voice-return')
    expect(req.headers['Content-Length']).toBe(String(req.body.length))
    expect(req.headers['Crypto-Key']).toBeUndefined() // legacy aesgcm header must not appear

    // Payload round-trip through an independent receiver.
    expect(JSON.parse(await uaDecrypt(req.body, ua))).toEqual(payload)

    // VAPID: Authorization: vapid t=<jwt>, k=<public key>
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(req.headers.Authorization)
    expect(m).not.toBeNull()
    const [, jwt, k] = m as RegExpExecArray
    expect(k).toBe(vapid.cfg.publicKey)
    const [h, c, s] = jwt.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
    expect(claims.aud).toBe('https://fcm.googleapis.com')
    expect(claims.sub).toBe('mailto:ops@example.test')
    expect(claims.exp).toBe(nowSec + 12 * 3600)
    expect(claims.exp - nowSec).toBeLessThanOrEqual(24 * 3600)
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      vapid.publicKey,
      fromB64u(s),
      utf8.encode(`${h}.${c}`),
    )
    expect(verified).toBe(true)
  })

  it('uses a fresh salt and ephemeral key per message', async () => {
    const vapid = await makeVapid()
    const ua = await makeUserAgent()
    const input = { subscription: { endpoint: SUB_APPLE, keys: ua.keys }, payload: { title: 'a', body: 'b' }, vapid: vapid.cfg }
    const a = await wp.buildWebPushRequest(input)
    const b = await wp.buildWebPushRequest(input)
    expect(b64u(a.body.slice(0, 16))).not.toBe(b64u(b.body.slice(0, 16)))
    expect(b64u(a.body.slice(21, 86))).not.toBe(b64u(b.body.slice(21, 86)))
  })

  it('refuses oversized payloads and malformed subscription keys', async () => {
    const vapid = await makeVapid()
    const ua = await makeUserAgent()
    await expect(
      wp.buildWebPushRequest({
        subscription: { endpoint: SUB_FCM, keys: ua.keys },
        payload: { title: 't', body: 'x'.repeat(wp.MAX_PUSH_PLAINTEXT_BYTES) },
        vapid: vapid.cfg,
      }),
    ).rejects.toThrow(/too large/)
    await expect(
      wp.buildWebPushRequest({
        subscription: { endpoint: SUB_FCM, keys: { p256dh: 'AAAA', auth: ua.keys.auth } },
        payload: { title: 't', body: 'b' },
        vapid: vapid.cfg,
      }),
    ).rejects.toThrow(/p256dh/)
    await expect(
      wp.buildWebPushRequest({
        subscription: { endpoint: SUB_FCM, keys: { p256dh: ua.keys.p256dh, auth: 'AAAA' } },
        payload: { title: 't', body: 'b' },
        vapid: vapid.cfg,
      }),
    ).rejects.toThrow(/auth/)
  })
})

// ── sending ──────────────────────────────────────────────────────────────────

function fakeFetch(statusFor: (url: string) => number | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init: init ?? {} })
    const status = statusFor(url)
    if (status instanceof Error) throw status
    return new Response(status >= 400 ? 'nope' : '', { status })
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

describe('sendWebPushToSubscription', () => {
  it('returns push_not_configured without fetching when VAPID is absent', async () => {
    const ua = await makeUserAgent()
    const f = fakeFetch(() => 201)
    const res = await wp.sendWebPushToSubscription({ endpoint: SUB_FCM, keys: ua.keys }, { title: 't', body: 'b' }, { fetch: f.fn, vapid: null })
    expect(res).toEqual({ ok: false, status: null, gone: false, error: 'push_not_configured' })
    expect(f.calls).toHaveLength(0)
  })

  it('never fetches a disallowed endpoint', async () => {
    const vapid = await makeVapid()
    const ua = await makeUserAgent()
    const f = fakeFetch(() => 201)
    const res = await wp.sendWebPushToSubscription(
      { endpoint: 'https://169.254.169.254/latest', keys: ua.keys },
      { title: 't', body: 'b' },
      { fetch: f.fn, vapid: vapid.cfg },
    )
    expect(res.ok).toBe(false)
    expect(res).toMatchObject({ gone: false, error: 'endpoint_not_allowed' })
    expect(f.calls).toHaveLength(0)
  })

  it('POSTs the encrypted body with redirect: error and a timeout, and classifies responses', async () => {
    const vapid = await makeVapid()
    const ua = await makeUserAgent()
    const sub = { endpoint: SUB_MOZ, keys: ua.keys }
    const ok = fakeFetch(() => 201)
    expect(await wp.sendWebPushToSubscription(sub, { title: 't', body: 'b' }, { fetch: ok.fn, vapid: vapid.cfg })).toEqual({ ok: true, status: 201 })
    expect(ok.calls[0].init.method).toBe('POST')
    expect(ok.calls[0].init.redirect).toBe('error')
    expect(ok.calls[0].init.signal).toBeInstanceOf(AbortSignal)
    expect((ok.calls[0].init.headers as Record<string, string>)['Content-Encoding']).toBe('aes128gcm')

    const gone = fakeFetch(() => 410)
    expect(await wp.sendWebPushToSubscription(sub, { title: 't', body: 'b' }, { fetch: gone.fn, vapid: vapid.cfg })).toMatchObject({ ok: false, status: 410, gone: true })
    const missing = fakeFetch(() => 404)
    expect(await wp.sendWebPushToSubscription(sub, { title: 't', body: 'b' }, { fetch: missing.fn, vapid: vapid.cfg })).toMatchObject({ ok: false, status: 404, gone: true })
    const throttled = fakeFetch(() => 429)
    expect(await wp.sendWebPushToSubscription(sub, { title: 't', body: 'b' }, { fetch: throttled.fn, vapid: vapid.cfg })).toMatchObject({ ok: false, status: 429, gone: false })
    const down = fakeFetch(() => new Error('ECONNRESET'))
    const res = await wp.sendWebPushToSubscription(sub, { title: 't', body: 'b' }, { fetch: down.fn, vapid: vapid.cfg })
    expect(res).toMatchObject({ ok: false, status: null, gone: false })
    expect((res as { error: string }).error).toMatch(/^transport: ECONNRESET/)
  })
})

describe('sendWebPushToUser', () => {
  const USER = 'user-1'

  async function seeded() {
    const ua = await makeUserAgent()
    const db = makeFakeDb({
      user_push_subscriptions: [
        { id: 's-fcm', user_id: USER, endpoint: SUB_FCM, p256dh: ua.keys.p256dh, auth: ua.keys.auth, failure_count: 0 },
        { id: 's-moz', user_id: USER, endpoint: SUB_MOZ, p256dh: ua.keys.p256dh, auth: ua.keys.auth, failure_count: 0 },
        { id: 's-apple', user_id: USER, endpoint: SUB_APPLE, p256dh: ua.keys.p256dh, auth: ua.keys.auth, failure_count: 2 },
        { id: 's-bad', user_id: USER, endpoint: 'https://evil.test/hook', p256dh: ua.keys.p256dh, auth: ua.keys.auth, failure_count: 0 },
        { id: 's-other', user_id: 'user-2', endpoint: SUB_FCM, p256dh: ua.keys.p256dh, auth: ua.keys.auth, failure_count: 0 },
      ],
    })
    return { ua, db }
  }

  it('returns push_not_configured and touches nothing when VAPID is absent', async () => {
    const { db } = await seeded()
    const f = fakeFetch(() => 201)
    expect(await wp.sendWebPushToUser(db as never, USER, { title: 't', body: 'b' }, { fetch: f.fn, vapid: null })).toEqual({ sent: 0, failed: 0, error: 'push_not_configured' })
    expect(f.calls).toHaveLength(0)
    expect(db.table('user_push_subscriptions')).toHaveLength(5)
  })

  it('reports no_subscriptions for a user without devices', async () => {
    const vapid = await makeVapid()
    const { db } = await seeded()
    const f = fakeFetch(() => 201)
    expect(await wp.sendWebPushToUser(db as never, 'user-none', { title: 't', body: 'b' }, { fetch: f.fn, vapid: vapid.cfg })).toEqual({ sent: 0, failed: 0, error: 'no_subscriptions' })
    expect(f.calls).toHaveLength(0)
  })

  it('stamps success, deletes 410 rows, counts other failures, skips disallowed hosts', async () => {
    const vapid = await makeVapid()
    const { db } = await seeded()
    const f = fakeFetch((url) => (url === SUB_FCM ? 201 : url === SUB_MOZ ? 410 : url === SUB_APPLE ? 500 : 201))

    const result = await wp.sendWebPushToUser(db as never, USER, { title: 'Draft PR ready', body: '#42' }, { fetch: f.fn, vapid: vapid.cfg })
    expect(result).toEqual({ sent: 1, failed: 3 })

    // Only the three allow-listed endpoints were contacted; the user-2 row was never touched.
    expect(f.calls.map((c) => c.url).sort()).toEqual([SUB_APPLE, SUB_FCM, SUB_MOZ].sort())

    const rows = db.table('user_push_subscriptions')
    const byId = Object.fromEntries(rows.map((r) => [r.id as string, r]))
    expect(byId['s-fcm'].last_success_at).toEqual(expect.any(String))
    expect(byId['s-fcm'].failure_count).toBe(0)
    expect(byId['s-moz']).toBeUndefined() // 410 → deleted
    expect(byId['s-apple'].failure_count).toBe(3)
    expect(byId['s-apple'].last_failure_at).toEqual(expect.any(String))
    expect(byId['s-bad'].failure_count).toBe(1) // disallowed host counts as a failure, never fetched
    expect(byId['s-other']).toBeDefined()
  })
})
