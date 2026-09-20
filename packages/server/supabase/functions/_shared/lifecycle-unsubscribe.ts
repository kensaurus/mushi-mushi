/**
 * FILE: packages/server/supabase/functions/_shared/lifecycle-unsubscribe.ts
 * PURPOSE: Signed one-click unsubscribe tokens for lifecycle emails.
 *
 * Token = `<user_id>.<hex HMAC-SHA256(user_id, LIFECYCLE_UNSUB_SECRET)>`.
 * The user id rides in the clear (it is a UUID, not a secret); the HMAC is
 * what proves the link came from us. Verification is constant-time.
 *
 * Shared by the lifecycle-emails cron (signs) and
 * GET|POST /v1/public/email/unsubscribe (verifies). No DB access here.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX64_RE = /^[0-9a-f]{64}$/

const encoder = new TextEncoder()

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Constant-time string equality (same length required). */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Reads LIFECYCLE_UNSUB_SECRET; null when unset so callers can fail closed. */
export function unsubscribeSecret(): string | null {
  const s = Deno.env.get('LIFECYCLE_UNSUB_SECRET')?.trim()
  return s && s.length >= 16 ? s : null
}

export async function signUnsubscribeToken(userId: string, secret: string): Promise<string> {
  const id = userId.toLowerCase()
  if (!UUID_RE.test(id)) throw new Error('signUnsubscribeToken: user id must be a UUID')
  return `${id}.${await hmacHex(secret, id)}`
}

/**
 * Returns the user id when the token is well-formed and its HMAC matches,
 * otherwise null. Never throws on malformed input.
 */
export async function verifyUnsubscribeToken(token: string | null | undefined, secret: string): Promise<string | null> {
  if (typeof token !== 'string' || token.length > 120) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const id = token.slice(0, dot).toLowerCase()
  const mac = token.slice(dot + 1).toLowerCase()
  if (!UUID_RE.test(id) || !HEX64_RE.test(mac)) return null
  const expected = await hmacHex(secret, id)
  return timingSafeEqualString(expected, mac) ? id : null
}
