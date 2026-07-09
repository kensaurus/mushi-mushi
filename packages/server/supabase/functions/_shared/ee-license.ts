/**
 * FILE: _shared/ee-license.ts
 * PURPOSE: Runtime gate for Enterprise Edition features (MUSHI_EE_LICENSE_KEY).
 *
 * SEMANTICS (must match packages/server/ee/LICENSE §3):
 *   - Unset / invalid key → **eval mode**: EE routes still work (development,
 *     testing, evaluation are licensed), but every response carries an
 *     `X-Mushi-Ee: eval` header and the server logs an eval banner. Production
 *     Use without a valid key is a license violation — contractually, not a
 *     hard-off switch. NEVER turn eval mode into a 402/403.
 *   - Valid key → licensed: `X-Mushi-Ee: licensed`, no banner.
 *
 * KEY FORMAT (offline-verifiable, no phone-home):
 *   mushi-ee.v1.<payloadB64url>.<sigB64url>
 *   payload = JSON { org: string, exp: "YYYY-MM-DD" }
 *   sig     = Ed25519 signature over the raw payload bytes.
 *
 * The Ed25519 public key is embedded below; the private key never leaves the
 * maintainer (see scripts/ee-license-tool.mjs for keygen + signing). Verify
 * happens entirely offline — self-hosted air-gapped deployments work.
 *
 * This module is a LEAF: no top-level env access, no DB, no other _shared
 * imports — so `verifyEeLicense` is unit-testable from the Deno test runner.
 */

/**
 * Maintainer's Ed25519 public key (base64url, 32 raw bytes), generated
 * 2026-07-08 via `node scripts/ee-license-tool.mjs keygen`. The matching
 * private key lives only in the maintainer's password manager — licenses are
 * minted with `node scripts/ee-license-tool.mjs sign <priv> <org> <exp>`.
 * Rotating the keypair (re-run keygen) invalidates all previously issued
 * licenses, so treat rotation as a customer-impacting event.
 */
export const EE_LICENSE_PUBLIC_KEY_B64URL = 'yxHAs8nDQq9v30yjp8ILcme1MpfhLh83wGtl67EJHvQ'

export type EeStatus =
  | { mode: 'licensed'; org: string; expiresAt: string }
  | { mode: 'eval'; reason: 'unset' | 'malformed' | 'bad-signature' | 'expired' }

const KEY_PREFIX = 'mushi-ee.v1.'

function b64urlToBytes(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    const bin = atob(b64 + pad)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * Pure(ish) verification — everything it needs comes in as arguments.
 * `now` is injectable so expiry tests don't depend on wall-clock time.
 */
export async function verifyEeLicense(
  licenseKey: string | undefined | null,
  publicKeyB64url: string = EE_LICENSE_PUBLIC_KEY_B64URL,
  now: Date = new Date(),
): Promise<EeStatus> {
  const key = licenseKey?.trim()
  if (!key) return { mode: 'eval', reason: 'unset' }
  if (!key.startsWith(KEY_PREFIX)) return { mode: 'eval', reason: 'malformed' }

  const parts = key.slice(KEY_PREFIX.length).split('.')
  if (parts.length !== 2) return { mode: 'eval', reason: 'malformed' }
  const payloadBytes = b64urlToBytes(parts[0])
  const sigBytes = b64urlToBytes(parts[1])
  const pubBytes = b64urlToBytes(publicKeyB64url)
  if (!payloadBytes || !sigBytes || !pubBytes || pubBytes.length !== 32) {
    return { mode: 'eval', reason: 'malformed' }
  }

  let payload: { org?: unknown; exp?: unknown }
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as { org?: unknown; exp?: unknown }
  } catch {
    return { mode: 'eval', reason: 'malformed' }
  }
  if (typeof payload.org !== 'string' || typeof payload.exp !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(payload.exp)) {
    return { mode: 'eval', reason: 'malformed' }
  }

  let valid = false
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      pubBytes as BufferSource,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    valid = await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      sigBytes as BufferSource,
      payloadBytes as BufferSource,
    )
  } catch {
    return { mode: 'eval', reason: 'bad-signature' }
  }
  if (!valid) return { mode: 'eval', reason: 'bad-signature' }

  // Expiry is date-granular; the key is valid THROUGH its exp day (UTC).
  const expMs = Date.parse(`${payload.exp}T23:59:59.999Z`)
  if (Number.isNaN(expMs)) return { mode: 'eval', reason: 'malformed' }
  if (now.getTime() > expMs) {
    return { mode: 'eval', reason: 'expired' }
  }

  return { mode: 'licensed', org: payload.org, expiresAt: payload.exp }
}
