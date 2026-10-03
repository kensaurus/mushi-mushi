/**
 * FILE: packages/server/supabase/functions/_shared/connectors/jwt.ts
 * PURPOSE: Short-lived signed JWTs for vendor APIs, on Web Crypto only:
 *          ES256 for App Store Connect (.p8 key) and RS256 for a Google
 *          service account (Play Developer API). Keys are imported per call
 *          and never logged.
 */

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlJson(v: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(v)))
}

/** PEM (PKCS#8, "BEGIN PRIVATE KEY") → DER bytes. Throws on anything else. */
export function pemToDer(pem: string): Uint8Array {
  const m = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(pem)
  if (!m) throw new Error('the key is not a PKCS#8 private key (BEGIN PRIVATE KEY)')
  const bin = atob(m[1].replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function signJwt(
  alg: 'ES256' | 'RS256',
  pem: string,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const der = pemToDer(pem)
  const key = alg === 'ES256'
    ? await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    : await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const input = `${b64urlJson({ ...header, alg, typ: 'JWT' })}.${b64urlJson(payload)}`
  const sig = alg === 'ES256'
    ? await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input))
    : await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input))
  // Web Crypto ECDSA output is already the raw r||s form JWS wants.
  return `${input}.${b64url(new Uint8Array(sig))}`
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
