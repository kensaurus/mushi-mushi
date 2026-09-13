// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/_shared/web-push.ts
 * PURPOSE: Web Push sender for the console PWA and the reporter widget
 *          (plan docs/execplans/dead-code-voice-agent-loop.md, C5).
 *
 *   RFC 8030  — HTTP push delivery (TTL / Urgency / Topic headers, 201 = queued)
 *   RFC 8291  — payload encryption, `aes128gcm` content coding (RFC 8188)
 *   RFC 8292  — VAPID: ES256 JWT in `Authorization: vapid t=…, k=…`
 *
 * Implemented directly on Web Crypto (ECDH P-256, HKDF-SHA-256, AES-128-GCM,
 * ECDSA P-256) so the edge function has no npm dependency. The plan named
 * `npm:@pushforge/builder@2.0.5`; its 2.0.5 build emits the pre-standard
 * `Content-Encoding: aesgcm` scheme (`Crypto-Key: dh=` / `Encryption: salt=`
 * headers), not RFC 8291 `aes128gcm`, which is the only coding Apple's
 * web.push.apple.com documents. Since the phone in this plan is usually an
 * iPhone with the console on the Home Screen, the standard coding is
 * non-negotiable, and it is ~150 lines on top of `crypto.subtle`.
 *
 * SSRF guard: `isAllowedPushEndpoint()` must pass before any fetch. Endpoints
 * are user-supplied URLs stored in the database; only the four known push
 * services are ever contacted.
 *
 * Key material (Supabase secrets, generated once, never in the repo):
 *   VAPID_PUBLIC_KEY   base64url, 65-byte uncompressed P-256 point (0x04 || X || Y)
 *                      — the same string the browser receives as applicationServerKey.
 *   VAPID_PRIVATE_KEY  base64url, 32-byte scalar `d` (a JSON JWK with x/y/d is
 *                      also accepted so keys from other generators work).
 *   VAPID_SUBJECT      `mailto:` or `https://` contact for the push service.
 *
 * Tests: packages/server/src/__tests__/web-push.test.ts (round-trip decrypt,
 * JWT verify, allow-list, 410 cleanup, not-configured path).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('web-push')

// ── Types ────────────────────────────────────────────────────────────────────

export interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface WebPushPayload {
  title: string
  body: string
  /** Path or absolute URL the notification opens; the SW resolves relative paths. */
  url?: string
  /** Collapses notifications with the same tag on the device. */
  tag?: string
  icon?: string
}

export interface VapidConfig {
  /** base64url uncompressed P-256 public key (65 bytes). */
  publicKey: string
  /** base64url 32-byte private scalar, or a JSON JWK string. */
  privateKey: string
  /** `mailto:` or `https://` contact. */
  subject: string
}

export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high'

export interface WebPushSendOptions {
  /** Seconds the push service keeps the message for an offline device. Default 24 h. */
  ttl?: number
  urgency?: PushUrgency
  topic?: string
  /** Outbound timeout. Default 10 s. */
  timeoutMs?: number
  /** Injection points for tests. */
  fetch?: typeof fetch
  vapid?: VapidConfig | null
}

export type WebPushSendResult =
  | { ok: true; status: number }
  | {
      ok: false
      /** HTTP status when the push service answered, null on transport / config failure. */
      status: number | null
      /** 404 / 410: the subscription is dead and must be deleted. */
      gone: boolean
      error: string
    }

export interface WebPushFanoutResult {
  sent: number
  failed: number
  error?: string
}

// ── Endpoint allow-list (SSRF guard) ─────────────────────────────────────────

/**
 * Hosts a browser-issued subscription endpoint may point at. Anything else is
 * refused both at subscribe time (API) and at send time (here), so a row that
 * somehow carries another host is still never fetched.
 */
const ALLOWED_EXACT_HOSTS = new Set(['fcm.googleapis.com'])
const ALLOWED_HOST_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com']

export function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  if (url.port && url.port !== '443') return false
  const host = url.hostname.toLowerCase()
  if (ALLOWED_EXACT_HOSTS.has(host)) return true
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)
}

// ── base64url helpers ────────────────────────────────────────────────────────

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(input: string): Uint8Array {
  const normalised = input.trim().replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Returns a copy backed by a plain ArrayBuffer (never a SharedArrayBuffer view). */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

const utf8 = new TextEncoder()

// ── VAPID configuration ──────────────────────────────────────────────────────

function readEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno
  const fromDeno = deno?.env?.get?.(name)
  if (fromDeno !== undefined) return fromDeno
  const node = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return node?.env?.[name]
}

/** Reads VAPID_* secrets. Returns null when any of the three is missing. */
export function getVapidConfig(): VapidConfig | null {
  const publicKey = readEnv('VAPID_PUBLIC_KEY')?.trim()
  const privateKey = readEnv('VAPID_PRIVATE_KEY')?.trim()
  const subject = readEnv('VAPID_SUBJECT')?.trim()
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

interface VapidKeyMaterial {
  /** 65-byte uncompressed point. */
  publicRaw: Uint8Array
  /** JWK with d, x, y — importable for ECDSA signing. */
  jwk: JsonWebKey
}

/**
 * Accepts either the base64url scalar form (matches `web-push generate-vapid-keys`
 * and this repo's `vapid.json`) or a JSON JWK string for the private key.
 */
export function parseVapidKeys(cfg: VapidConfig): VapidKeyMaterial {
  const publicRaw = base64UrlDecode(cfg.publicKey)
  if (publicRaw.length !== 65 || publicRaw[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY must be a base64url 65-byte uncompressed P-256 point')
  }
  const x = base64UrlEncode(publicRaw.slice(1, 33))
  const y = base64UrlEncode(publicRaw.slice(33, 65))

  let d: string
  const trimmed = cfg.privateKey.trim()
  if (trimmed.startsWith('{')) {
    let parsed: { d?: unknown; x?: unknown; y?: unknown }
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('VAPID_PRIVATE_KEY JWK is not valid JSON')
    }
    if (typeof parsed.d !== 'string') throw new Error('VAPID_PRIVATE_KEY JWK is missing "d"')
    if (typeof parsed.x === 'string' && parsed.x !== x) {
      throw new Error('VAPID_PRIVATE_KEY JWK does not match VAPID_PUBLIC_KEY')
    }
    d = parsed.d
  } else {
    d = trimmed
  }
  if (base64UrlDecode(d).length !== 32) {
    throw new Error('VAPID_PRIVATE_KEY must be a base64url 32-byte P-256 scalar (or a JWK)')
  }

  return {
    publicRaw,
    jwk: { kty: 'EC', crv: 'P-256', x, y, d, ext: true },
  }
}

// ── VAPID JWT (RFC 8292) ─────────────────────────────────────────────────────

/** JWT lifetime. Push services reject exp > 24 h; 12 h leaves clock-skew room. */
const VAPID_JWT_TTL_SEC = 12 * 60 * 60

export async function signVapidJwt(
  cfg: VapidConfig,
  audience: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const { jwk } = parseVapidKeys(cfg)
  const header = base64UrlEncode(utf8.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = base64UrlEncode(
    utf8.encode(JSON.stringify({ aud: audience, exp: nowSec + VAPID_JWT_TTL_SEC, sub: cfg.subject })),
  )
  const signingInput = `${header}.${claims}`
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ])
  // Web Crypto ECDSA emits the raw r||s (64 bytes) that JWS ES256 expects.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8.encode(signingInput))
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`
}

// ── Payload encryption (RFC 8291 / RFC 8188 aes128gcm) ───────────────────────

/** RFC 8188 record size we emit; a push message is always a single record. */
const RECORD_SIZE = 4096
/** Payload ceiling: record size minus the 16-byte GCM tag minus the 1-byte delimiter. */
export const MAX_PUSH_PLAINTEXT_BYTES = RECORD_SIZE - 16 - 1

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, lengthBytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', toBuffer(ikm), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: toBuffer(salt), info: toBuffer(info) },
    key,
    lengthBytes * 8,
  )
  return new Uint8Array(bits)
}

export interface EncryptOptions {
  /** Injected application-server ECDH key pair (tests); generated per message otherwise. */
  asKeyPair?: CryptoKeyPair
  /** Injected 16-byte salt (tests); random otherwise. */
  salt?: Uint8Array
}

/**
 * Encrypts `plaintext` for the subscription's `p256dh` / `auth` keys and returns
 * the full aes128gcm body: header (salt, rs, keyid = AS public key) + record.
 */
export async function encryptAes128Gcm(
  plaintext: Uint8Array,
  uaPublicKeyB64: string,
  authSecretB64: string,
  opts: EncryptOptions = {},
): Promise<Uint8Array> {
  if (plaintext.length > MAX_PUSH_PLAINTEXT_BYTES) {
    throw new Error(`push payload too large (${plaintext.length} > ${MAX_PUSH_PLAINTEXT_BYTES} bytes)`)
  }
  const uaPublic = base64UrlDecode(uaPublicKeyB64)
  const authSecret = base64UrlDecode(authSecretB64)
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('p256dh must be a 65-byte uncompressed point')
  if (authSecret.length !== 16) throw new Error('auth must be 16 bytes')

  const asKeyPair =
    opts.asKeyPair ??
    (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']))
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', toBuffer(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeyPair.privateKey, 256),
  )

  // RFC 8291 §3.3 — IKM from the ECDH secret, auth secret and both public keys.
  const keyInfo = concat(utf8.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)

  // RFC 8188 §2 — content-encryption key and nonce.
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16))
  if (salt.length !== 16) throw new Error('salt must be 16 bytes')
  const cek = await hkdf(salt, ikm, utf8.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8.encode('Content-Encoding: nonce\0'), 12)

  // Single, final record: plaintext || 0x02 delimiter (no padding needed).
  const record = concat(plaintext, new Uint8Array([0x02]))
  const aesKey = await crypto.subtle.importKey('raw', toBuffer(cek), 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toBuffer(nonce) }, aesKey, toBuffer(record)),
  )

  // RFC 8188 §2.1 header: salt(16) | rs(4, BE) | idlen(1) | keyid(idlen)
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false)
  header[20] = asPublic.length
  header.set(asPublic, 21)

  return concat(header, ciphertext)
}

// ── Request builder ──────────────────────────────────────────────────────────

export interface BuiltWebPushRequest {
  endpoint: string
  headers: Record<string, string>
  body: Uint8Array
}

export async function buildWebPushRequest(input: {
  subscription: WebPushSubscription
  payload: WebPushPayload
  vapid: VapidConfig
  ttl?: number
  urgency?: PushUrgency
  topic?: string
  encrypt?: EncryptOptions
  nowSec?: number
}): Promise<BuiltWebPushRequest> {
  const { subscription, payload, vapid } = input
  const endpointUrl = new URL(subscription.endpoint)
  const plaintext = utf8.encode(JSON.stringify(payload))
  const body = await encryptAes128Gcm(plaintext, subscription.keys.p256dh, subscription.keys.auth, input.encrypt)
  const jwt = await signVapidJwt(vapid, endpointUrl.origin, input.nowSec)
  const { publicRaw } = parseVapidKeys(vapid)

  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'Content-Encoding': 'aes128gcm',
    'Content-Length': String(body.length),
    TTL: String(input.ttl ?? 24 * 60 * 60),
    Authorization: `vapid t=${jwt}, k=${base64UrlEncode(publicRaw)}`,
  }
  if (input.urgency) headers.Urgency = input.urgency
  if (input.topic) headers.Topic = input.topic.slice(0, 32)

  return { endpoint: subscription.endpoint, headers, body }
}

// ── Sending ──────────────────────────────────────────────────────────────────

const DEFAULT_PUSH_TIMEOUT_MS = 10_000

/**
 * Sends one notification to one subscription. Never throws: config, allow-list,
 * transport and HTTP failures all come back as `{ ok: false }` so callers can
 * do bookkeeping without try/catch. `gone` means "delete this subscription".
 */
export async function sendWebPushToSubscription(
  subscription: WebPushSubscription,
  payload: WebPushPayload,
  opts: WebPushSendOptions = {},
): Promise<WebPushSendResult> {
  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    return { ok: false, status: null, gone: false, error: 'endpoint_not_allowed' }
  }
  const vapid = opts.vapid === undefined ? getVapidConfig() : opts.vapid
  if (!vapid) return { ok: false, status: null, gone: false, error: 'push_not_configured' }

  let request: BuiltWebPushRequest
  try {
    request = await buildWebPushRequest({
      subscription,
      payload,
      vapid,
      ttl: opts.ttl,
      urgency: opts.urgency,
      topic: opts.topic,
    })
  } catch (err) {
    return {
      ok: false,
      status: null,
      gone: false,
      error: `build_failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const doFetch = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PUSH_TIMEOUT_MS
  let res: Response
  try {
    res = await doFetch(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: toBuffer(request.body),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    return {
      ok: false,
      status: null,
      gone: false,
      error: `transport: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // Drain the body so the connection can be reused; the text is only useful for logs.
  const text = await res.text().catch(() => '')
  if (res.ok) return { ok: true, status: res.status }
  const gone = res.status === 404 || res.status === 410
  return { ok: false, status: res.status, gone, error: `push_${res.status}${text ? `: ${text.slice(0, 160)}` : ''}` }
}

interface UserPushRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  failure_count: number | null
}

/**
 * Fans a notification out to every device a console user has subscribed.
 * Bookkeeping per row: success → last_success_at + failure_count = 0;
 * 404/410 → row deleted; anything else → failure_count + 1, last_failure_at.
 */
export async function sendWebPushToUser(
  db: SupabaseClient,
  userId: string,
  payload: WebPushPayload,
  opts: WebPushSendOptions = {},
): Promise<WebPushFanoutResult> {
  const vapid = opts.vapid === undefined ? getVapidConfig() : opts.vapid
  if (!vapid) return { sent: 0, failed: 0, error: 'push_not_configured' }

  const { data, error } = await db
    .from('user_push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .eq('user_id', userId)
  if (error) {
    log.error('load_subscriptions_failed', { userId, err: error.message })
    return { sent: 0, failed: 0, error: `db: ${error.message}` }
  }
  const rows = (data ?? []) as UserPushRow[]
  if (rows.length === 0) return { sent: 0, failed: 0, error: 'no_subscriptions' }

  let sent = 0
  let failed = 0
  const now = new Date().toISOString()
  for (const row of rows) {
    const result = await sendWebPushToSubscription(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      payload,
      { ...opts, vapid },
    )
    if (result.ok) {
      sent++
      await db
        .from('user_push_subscriptions')
        .update({ last_success_at: now, failure_count: 0 })
        .eq('id', row.id)
      continue
    }
    failed++
    if (result.gone) {
      log.info('subscription_gone', { userId, id: row.id, status: result.status })
      await db.from('user_push_subscriptions').delete().eq('id', row.id)
      continue
    }
    log.warn('push_delivery_failed', { userId, id: row.id, status: result.status, err: result.error })
    await db
      .from('user_push_subscriptions')
      .update({ last_failure_at: now, failure_count: (row.failure_count ?? 0) + 1 })
      .eq('id', row.id)
  }

  return { sent, failed }
}
