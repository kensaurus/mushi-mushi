/**
 * Server-side TIN hashing for tester KYC.
 *
 * Bare SHA-256 is trivially brute-forceable for US SSNs (~10^9 values).
 * HMAC-SHA256 with a server-side pepper means a DB-only leak cannot be
 * reversed without the TESTER_TIN_PEPPER secret.
 */

/** Strip whitespace/dashes; uppercase for stable normalization. */
export function normalizeTin(raw: string): string {
  return raw.trim().replace(/[\s-]/g, '').toUpperCase()
}

/** HMAC-SHA256 hex digest keyed by the server pepper. */
export async function hashTesterTin(normalizedTin: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(normalizedTin))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
