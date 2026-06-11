/**
 * RFC-4122 v4 UUID generator with a capability ladder so it works in every
 * runtime a Mushi SDK ships to:
 *
 *   1. `crypto.randomUUID()`      — browsers (secure context), Node 19+, Deno
 *   2. `crypto.getRandomValues()` — older browsers, RN with a crypto polyfill
 *   3. `Math.random()`            — Hermes / JSC without a crypto polyfill
 *
 * Why this exists: report ids are written to the `reports.id uuid` column on
 * the backend. SDKs that minted ad-hoc ids (`rn-<ts>-<rand>`, `mushi_<hex>`)
 * failed the Postgres uuid cast (22P02) and the report was silently dropped
 * (Sentry MUSHI-MUSHI-SERVER-D). Emitting a well-formed UUID at the source
 * keeps the value valid end-to-end.
 *
 * A report id is an identifier, not a secret. The `Math.random` fallback only
 * affects collision odds — negligible at our volume, and the backend dedupes
 * on the `reports` primary key regardless — so we never throw just because a
 * runtime lacks a CSPRNG.
 */
export function newUuid(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c?.randomUUID) {
    return c.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Pin version (4) and variant (10xx) bits per RFC 4122 §4.4.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
