/**
 * FILE: packages/server/supabase/functions/_shared/reporter-token.ts
 * PURPOSE: Turn an SDK reporter token into the value we are allowed to store.
 *
 * The reporter token is a bearer credential: the report-thread routes
 * (api/routes/public.ts) accept the raw token and hash it to find the
 * reporter's reports, so anyone holding the raw value can read that end user's
 * threads and reply as them. The report path has always stored only
 * sha256(token). The session and analytics routes did not: the web SDK sends
 * the raw token (under the misleading field name `reporter_token_hash`) and
 * both routes stored it verbatim — 26,523 raw credentials in end_user_sessions
 * by 2026-09-21, readable by every org member.
 *
 * Every write of a reporter token outside the report path goes through
 * `hashReporterToken`, which yields exactly what the report path stores, so
 * joins between reports, sessions, product events and anti-fraud device rows
 * line up. A value that is already a 64-char lowercase hex digest passes
 * through unchanged (SDKs using the X-Reporter-Token-Hash + HMAC path already
 * send the digest), which also makes the function idempotent.
 */

const SHA256_HEX = /^[0-9a-f]{64}$/

export async function hashReporterToken(value: string): Promise<string> {
  if (SHA256_HEX.test(value)) return value
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Null-preserving convenience for optional fields. */
export async function hashReporterTokenOrNull(value: string | null | undefined): Promise<string | null> {
  return value ? hashReporterToken(value) : null
}
