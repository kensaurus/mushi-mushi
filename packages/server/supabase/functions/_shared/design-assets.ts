/**
 * FILE: packages/server/supabase/functions/_shared/design-assets.ts
 * PURPOSE: Short-lived signed URLs for design-direction images (Plan 019
 *          Directions board). An <img> cannot send the console's bearer token,
 *          so the board gets `/v1/design-assets/:projectId?path&exp&sig`, an
 *          HMAC-SHA256 over (project, path, expiry). The serving route also
 *          re-checks that the path is an asset the current snapshot lists, so
 *          a valid signature still cannot read an arbitrary repo file.
 *
 * The key is derived from the service-role key with a fixed label, so no new
 * secret has to be provisioned and the derived key is useless elsewhere.
 */

export const ASSET_URL_TTL_SEC = 15 * 60
const LABEL = 'mushi-design-asset-v1'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
}

/** Image MIME type for a path, or null for anything that is not served. */
export function assetMime(path: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  return ext ? MIME[ext] ?? null : null
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const derived = new Uint8Array(await crypto.subtle.sign('HMAC', base, enc.encode(LABEL)))
  const key = await crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function payload(projectId: string, path: string, exp: number): string {
  return `${projectId}\n${path}\n${exp}`
}

/** A relative URL (to the api base) valid for `ttlSec`. */
export async function signAssetUrl(secret: string, projectId: string, path: string, nowMs: number, ttlSec = ASSET_URL_TTL_SEC): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + ttlSec
  const sig = await hmacHex(secret, payload(projectId, path, exp))
  const q = new URLSearchParams({ path, exp: String(exp), sig })
  return `/v1/design-assets/${encodeURIComponent(projectId)}?${q.toString()}`
}

export type AssetSigCheck = { ok: true } | { ok: false; reason: 'expired' | 'bad_signature' | 'malformed' }

/** Constant-time check of a signed asset request. */
export async function verifyAssetSignature(secret: string, projectId: string, path: string, exp: string | undefined, sig: string | undefined, nowMs: number): Promise<AssetSigCheck> {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: 'malformed' }
  if (Number(exp) * 1000 < nowMs) return { ok: false, reason: 'expired' }
  const expected = await hmacHex(secret, payload(projectId, path, Number(exp)))
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0 ? { ok: true } : { ok: false, reason: 'bad_signature' }
}
