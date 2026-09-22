/**
 * FILE: packages/server/supabase/functions/_shared/reporter-token.ts
 * PURPOSE: Turn a reporter credential into the value we are allowed to store.
 *
 * The reporter token is a bearer credential for an end user's report threads
 * (api/routes/public.ts): whoever presents it can read those threads and reply
 * as the reporter. SDKs present it two ways:
 *
 *   - the raw token (`mushi_<uuid>`), on report ingest and the legacy
 *     X-Reporter-Token / ?reporterToken= path;
 *   - its SHA-256 hex digest, on the X-Reporter-Token-Hash + X-Reporter-Hmac
 *     path. The HMAC is keyed by the public API key, so the digest alone is
 *     enough to pass it: the digest is a credential too.
 *
 * Until 2026-09-22 the server stored that digest, so every value an org member
 * could see in the console (with a copy button), and every value an
 * integration echoed, could be replayed on the reporter-thread routes.
 *
 * Storage now holds a verifier: `rk1_` + sha256(digest). Reading it grants
 * nothing, the same way a password hash does not log you in. Every value a
 * client presents goes through `reporterKey` exactly once:
 *
 *   raw token      → sha256 → digest ─┐
 *   64-hex digest  ─────────→ digest ─┴→ sha256 → `rk1_<hex>`
 *
 * The `rk1_` prefix keeps stored keys distinguishable from digests, so the
 * backfill (mushi.rekey_reporter_tokens) is idempotent, and it versions the
 * scheme. A stored key presented back as a credential is not a digest, so it
 * is hashed as a raw token and matches nothing.
 *
 * The SQL twin is public.mushi_reporter_key(text); reporter-key.test.ts pins
 * both to the same vectors.
 */

const REPORTER_KEY_PREFIX = 'rk1_'

const DIGEST_HEX = /^[0-9a-f]{64}$/i

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Storage key for a client-presented reporter credential (raw token or its
 * digest). Not idempotent by design: never apply it to a value read back from
 * the database.
 */
export async function reporterKey(presented: string): Promise<string> {
  const digest = DIGEST_HEX.test(presented) ? presented.toLowerCase() : await sha256Hex(presented)
  return REPORTER_KEY_PREFIX + (await sha256Hex(digest))
}

/** Null-preserving convenience for optional fields. */
export async function reporterKeyOrNull(presented: string | null | undefined): Promise<string | null> {
  return presented ? reporterKey(presented) : null
}
