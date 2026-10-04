/**
 * FILE: packages/server/supabase/functions/_shared/byok-expiry.ts
 * PURPOSE: Validate the optional "expires on" date an owner types when adding
 *          a provider key (Supabase access tokens are created with one, and no
 *          Supabase API exposes it afterwards). Stored in byok_keys.expires_at.
 *
 *          Accepts `YYYY-MM-DD` (end of that day, UTC) or a full ISO
 *          timestamp. `null`, `undefined` and `''` mean "no expiry known".
 */

const MAX_YEARS_AHEAD = 10

export type ByokExpiryVerdict =
  | { ok: true; value: string | null }
  | { ok: false; message: string }

export function parseByokExpiry(value: unknown, now: number = Date.now()): ByokExpiryVerdict {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string') {
    return { ok: false, message: 'The expiry date must be a date like 2027-01-31.' }
  }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
  const at = Date.parse(dateOnly ? `${trimmed}T23:59:59Z` : trimmed)
  if (!Number.isFinite(at)) {
    return { ok: false, message: 'The expiry date must be a date like 2027-01-31.' }
  }
  if (dateOnly && new Date(at).toISOString().slice(0, 10) !== trimmed) {
    // 2027-02-30 parses as March 2 in some engines; refuse instead.
    return { ok: false, message: `${trimmed} is not a real date.` }
  }
  if (at <= now) {
    return {
      ok: false,
      message: 'That date has already passed. A key that has expired will not work; create a new one.',
    }
  }
  const latest = new Date(now)
  latest.setUTCFullYear(latest.getUTCFullYear() + MAX_YEARS_AHEAD)
  if (at > latest.getTime()) {
    return { ok: false, message: `Pick a date within ${MAX_YEARS_AHEAD} years, or leave it empty.` }
  }
  return { ok: true, value: new Date(at).toISOString() }
}
