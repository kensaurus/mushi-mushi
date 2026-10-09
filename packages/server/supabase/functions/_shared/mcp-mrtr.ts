/**
 * FILE: packages/server/supabase/functions/_shared/mcp-mrtr.ts
 * PURPOSE: Multi-Round-Trip Requests (MRTR, SEP-2322, part of MCP
 *          2026-07-28 core) for the hosted MCP endpoint.
 *
 * Only `tools/call`, `resources/read` and `prompts/get` may answer
 *
 *   { resultType: "input_required",
 *     inputRequests: { <key>: { method: "elicitation/create", params: {...} } },
 *     requestState: "<opaque>" }
 *
 * The client then retries the SAME request with a NEW id, adding
 * `params.inputResponses: { <key>: ElicitResult }` and echoing
 * `params.requestState`. The server is stateless between the two legs, so
 * `requestState` is the only memory it has — and it comes back from the
 * client, i.e. it is attacker-controlled. It is therefore an HMAC-SHA256
 * signed envelope with a 10-minute expiry and a single-use nonce:
 *
 *   base64url(json{ v, iat, exp, nonce, payload }) "." base64url(hmac)
 *
 * The key is `MUSHI_INTERNAL_CALLER_SECRET`, falling back to
 * `SUPABASE_SERVICE_ROLE_KEY` (both already exist in the edge environment;
 * no new secret to provision). Signing/verification take the secret as an
 * argument so the codec is testable without env access.
 *
 * Single use: the codec keeps an in-isolate consumed-nonce set (cheap
 * replay defence); callers that need a cross-isolate guarantee ALSO pin the
 * payload to a compare-and-swap on the underlying row (the voice gate flips
 * `voice_intake_sessions.status` from `awaiting_confirm` exactly once).
 */

export const REQUEST_STATE_TTL_MS = 10 * 60_000
const REQUEST_STATE_VERSION = 1

// ── Wire shapes ──────────────────────────────────────────────────────────────

export interface ElicitationRequest {
  method: 'elicitation/create'
  params: {
    message: string
    requestedSchema: Record<string, unknown>
  }
}

export interface ElicitResult {
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

export interface InputRequiredResult extends Record<string, unknown> {
  resultType: 'input_required'
  inputRequests: Record<string, ElicitationRequest>
  requestState: string
}

export function elicitationRequest(message: string, requestedSchema: Record<string, unknown>): ElicitationRequest {
  return { method: 'elicitation/create', params: { message, requestedSchema } }
}

export function buildInputRequired(
  inputRequests: Record<string, ElicitationRequest>,
  requestState: string,
): InputRequiredResult {
  return { resultType: 'input_required', inputRequests, requestState }
}

/** Strictly parse an ElicitResult; anything malformed is `null`. */
export function parseElicitResult(value: unknown): ElicitResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (v.action !== 'accept' && v.action !== 'decline' && v.action !== 'cancel') return null
  const content =
    v.content && typeof v.content === 'object' && !Array.isArray(v.content)
      ? (v.content as Record<string, unknown>)
      : undefined
  return { action: v.action, ...(content ? { content } : {}) }
}

/** `params.inputResponses` as a map of parsed ElicitResults (invalid entries dropped). */
export function readInputResponses(params: Record<string, unknown> | undefined): Record<string, ElicitResult> {
  const raw = params?.inputResponses
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, ElicitResult> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = parseElicitResult(v)
    if (parsed) out[k] = parsed
  }
  return out
}

// ── Codec ────────────────────────────────────────────────────────────────────

export interface RequestStateEnvelope<T> {
  v: number
  iat: number
  exp: number
  nonce: string
  payload: T
}

export type RequestStateVerify<T> =
  | { ok: true; payload: T; nonce: string; exp: number }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'replayed' | 'version' }

export interface RequestStateCodec<T> {
  sign(payload: T, now?: number): Promise<string>
  verify(token: unknown, now?: number): Promise<RequestStateVerify<T>>
}

export interface RequestStateCodecOptions {
  secret: string
  ttlMs?: number
  /**
   * Mark a nonce as consumed. Return `false` if it was already consumed.
   * Defaults to an in-isolate memory set (see {@link createMemoryNonceStore}).
   */
  consumeNonce?: (nonce: string, exp: number) => boolean | Promise<boolean>
}

const enc = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  try {
    const bin = atob(b64)
    const out = new Uint8Array(new ArrayBuffer(bin.length))
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

/**
 * In-isolate replay guard. Entries expire with the envelope so the set
 * cannot grow without bound on a long-lived isolate.
 */
export function createMemoryNonceStore(): (nonce: string, exp: number) => boolean {
  const seen = new Map<string, number>()
  return (nonce, exp) => {
    const now = Date.now()
    if (seen.size > 512) {
      for (const [k, e] of seen) if (e <= now) seen.delete(k)
    }
    if (seen.has(nonce)) return false
    seen.set(nonce, exp)
    return true
  }
}

export function createRequestStateCodec<T>(opts: RequestStateCodecOptions): RequestStateCodec<T> {
  const ttlMs = opts.ttlMs ?? REQUEST_STATE_TTL_MS
  const consume = opts.consumeNonce ?? createMemoryNonceStore()
  let keyPromise: Promise<CryptoKey> | null = null
  const key = () => (keyPromise ??= hmacKey(opts.secret))

  return {
    async sign(payload, now = Date.now()) {
      const envelope: RequestStateEnvelope<T> = {
        v: REQUEST_STATE_VERSION,
        iat: now,
        exp: now + ttlMs,
        nonce: randomNonce(),
        payload,
      }
      const body = toBase64Url(enc.encode(JSON.stringify(envelope)))
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(), enc.encode(body)))
      return `${body}.${toBase64Url(sig)}`
    },

    async verify(token, now = Date.now()) {
      if (typeof token !== 'string' || token.length > 8192) return { ok: false, reason: 'malformed' }
      const dot = token.indexOf('.')
      if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' }
      const body = token.slice(0, dot)
      const sigBytes = fromBase64Url(token.slice(dot + 1))
      if (!sigBytes || sigBytes.length !== 32) return { ok: false, reason: 'malformed' }
      // crypto.subtle.verify is constant-time; never compare signatures with ===.
      const valid = await crypto.subtle.verify('HMAC', await key(), sigBytes, enc.encode(body))
      if (!valid) return { ok: false, reason: 'bad_signature' }
      const bodyBytes = fromBase64Url(body)
      if (!bodyBytes) return { ok: false, reason: 'malformed' }
      let envelope: RequestStateEnvelope<T>
      try {
        envelope = JSON.parse(new TextDecoder().decode(bodyBytes)) as RequestStateEnvelope<T>
      } catch {
        return { ok: false, reason: 'malformed' }
      }
      if (!envelope || typeof envelope !== 'object') return { ok: false, reason: 'malformed' }
      if (envelope.v !== REQUEST_STATE_VERSION) return { ok: false, reason: 'version' }
      if (typeof envelope.exp !== 'number' || typeof envelope.nonce !== 'string' || !envelope.nonce) {
        return { ok: false, reason: 'malformed' }
      }
      if (envelope.exp <= now) return { ok: false, reason: 'expired' }
      if (!(await consume(envelope.nonce, envelope.exp))) return { ok: false, reason: 'replayed' }
      return { ok: true, payload: envelope.payload, nonce: envelope.nonce, exp: envelope.exp }
    },
  }
}

/** Key material for the codec: internal caller secret, else the service-role key. */
export function resolveRequestStateSecret(env: { get(name: string): string | undefined }): string | null {
  const internal = env.get('MUSHI_INTERNAL_CALLER_SECRET')
  if (internal && internal.trim()) return internal.trim()
  const service = env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (service && service.trim()) return service.trim()
  return null
}

/** Human-readable reason for a rejected requestState (goes into error.message). */
export function describeRequestStateFailure(reason: Exclude<RequestStateVerify<unknown>, { ok: true }>['reason']): string {
  switch (reason) {
    case 'expired':
      return 'requestState has expired (10 minute limit); call the tool again to get a fresh confirmation request'
    case 'replayed':
      return 'requestState was already used; call the tool again to get a fresh confirmation request'
    case 'bad_signature':
      return 'requestState signature is invalid'
    case 'version':
      return 'requestState was issued by an incompatible server version'
    default:
      return 'requestState is malformed'
  }
}
