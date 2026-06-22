/**
 * FILE: packages/core/src/digest.ts
 * PURPOSE: SHA-256 and HMAC-SHA-256 helpers that work in every JS runtime —
 *          including Hermes (React Native) which has no global `crypto` object.
 *
 * OVERVIEW:
 * Fast path: when `globalThis.crypto?.subtle` is available (browser, Deno,
 * Node ≥ 16, React Native with polyfill) we delegate to the native Web Crypto
 * API which is hardware-accelerated and produces identical output.
 *
 * Fallback: `@noble/hashes` — pure-JS, audited, zero-dependency implementation
 * of SHA-256 and HMAC used when native crypto is absent (Hermes cold start
 * before any polyfill loads, worker environments without crypto, SSR edge runtimes).
 *
 * Both paths are spec-identical (same test vectors) and are exercised by
 * `digest.test.ts`.
 *
 * USAGE:
 *   import { sha256Hex, hmacSha256Hex } from './digest';
 *   const hash = await sha256Hex('hello');
 *   const sig  = await hmacSha256Hex('secret', 'message');
 */

type SubtleCrypto = typeof globalThis extends { crypto: { subtle: infer S } } ? S : never;

function getSubtle(): SubtleCrypto | null {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    const crypto = g['crypto'] as { subtle?: SubtleCrypto } | undefined;
    if (crypto?.subtle) return crypto.subtle;
  } catch {
    // some envs throw on globalThis access
  }
  return null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SHA-256 of `value`, returned as a lowercase hex string.
 * Uses Web Crypto when available, falls back to @noble/hashes.
 */
export async function sha256Hex(value: string): Promise<string> {
  const subtle = getSubtle();
  if (subtle) {
    const buffer = await subtle.digest('SHA-256', new TextEncoder().encode(value));
    return bytesToHex(new Uint8Array(buffer));
  }
  const { sha256 } = await import('@noble/hashes/sha2.js');
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}

/**
 * HMAC-SHA-256 of `value` with `secret`, returned as a lowercase hex string.
 * Uses Web Crypto when available, falls back to @noble/hashes.
 */
export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const subtle = getSubtle();
  if (subtle) {
    const key = await subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const buffer = await subtle.sign('HMAC', key, new TextEncoder().encode(value));
    return bytesToHex(new Uint8Array(buffer));
  }
  const { hmac } = await import('@noble/hashes/hmac.js');
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const result = hmac(sha256, new TextEncoder().encode(secret), new TextEncoder().encode(value));
  return bytesToHex(result);
}
