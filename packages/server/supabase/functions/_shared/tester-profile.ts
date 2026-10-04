/**
 * FILE: packages/server/supabase/functions/_shared/tester-profile.ts
 * PURPOSE: Pure validation for the tester self-service routes in
 *          api/routes/tester-marketplace.ts (PUT /v1/tester/me, PUT /v1/tester/kyc).
 *          No Deno or network imports, so it is unit-testable under vitest.
 */

export type TesterProfileUpdate =
  | {
      ok: true
      /** Columns of public.mushi_testers. */
      testerUpdates: Record<string, unknown>
      /** Columns of public.mushi_tester_profiles. */
      profileUpdates: Record<string, unknown>
    }
  | { ok: false; code: 'VALIDATION_ERROR'; message: string }

/**
 * Map a PUT /v1/tester/me body to column updates. Each privacy flag writes its
 * own column: "Show my handle" → public_handle_visible, "Include my stats in
 * the leaderboard" → public_leaderboard. They used to share one column, so
 * unticking only one of them did nothing.
 */
export function testerProfileUpdate(body: Record<string, unknown>): TesterProfileUpdate {
  const testerUpdates: Record<string, unknown> = {}
  const profileUpdates: Record<string, unknown> = {}

  if (typeof body.handle === 'string') {
    // Same normalisation as before; an empty handle is left unchanged.
    const handle = body.handle.trim().replace(/\s+/g, '-').toLowerCase().slice(0, 32)
    if (handle.length > 0) testerUpdates.public_handle = handle
  }
  if (typeof body.country === 'string') {
    const country = body.country.trim().toUpperCase().slice(0, 2)
    if (country.length === 1) {
      // mushi_testers.country_code has CHECK (length = 2).
      return { ok: false, code: 'VALIDATION_ERROR', message: 'Pick your country from the list (a two-letter code such as US or JP).' }
    }
    if (country.length === 2) testerUpdates.country_code = country
  }
  if (typeof body.privacyPublicLeaderboard === 'boolean') {
    testerUpdates.public_leaderboard = body.privacyPublicLeaderboard
  }
  if (typeof body.privacyPublicHandle === 'boolean') {
    testerUpdates.public_handle_visible = body.privacyPublicHandle
  }

  if (typeof body.bio === 'string') profileUpdates.bio = body.bio.slice(0, 500)
  if (Array.isArray(body.expertiseTags)) {
    profileUpdates.expertise_tags = body.expertiseTags.filter((t): t is string => typeof t === 'string').slice(0, 10)
  }

  return { ok: true, testerUpdates, profileUpdates }
}

/** The legal name for tester_kyc.legal_name, or null when it is missing. */
export function normalizeLegalName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name.length === 0) return null
  return name.slice(0, 200)
}
