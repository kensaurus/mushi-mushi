/**
 * FILE: _shared/sanctions.ts
 * PURPOSE: OFAC + EU sanctions country-code gate for gift-card redemptions
 *          and any other monetary flow that carries sanctions-compliance risk.
 *
 * The list below is a simplified, conservative set derived from OFAC SDN /
 * comprehensive country programs (as of 2026-05). For a production rollout
 * this list should be refreshed from the official OFAC CSV feed or a
 * compliance-provider API (e.g. Comply Advantage). Updates here require a
 * redeploy of the edge function.
 *
 * Usage:
 *   const result = checkSanctions(countryCode)  // "IR", "RU", "CU", …
 *   if (result.blocked) { return 403 }
 */

/** Two-letter ISO-3166-1 alpha-2 codes whose residents are blocked from
 *  receiving gift-card or cash-equivalent rewards due to OFAC programs
 *  and analogous regimes. */
const BLOCKED_COUNTRY_CODES: ReadonlySet<string> = new Set([
  'CU', // Cuba — OFAC comprehensive
  'IR', // Iran — OFAC comprehensive
  'KP', // North Korea — OFAC comprehensive
  'RU', // Russia — post-2022 comprehensive SDN + sectoral
  'SY', // Syria — OFAC comprehensive
  'BY', // Belarus — post-2020 significant expansion
  'MM', // Myanmar (Burma) — OFAC sectoral
  'VE', // Venezuela — OFAC SDN / Maduro regime
  'SD', // Sudan — OFAC comprehensive
  'SS', // South Sudan — UN arms embargo / OFAC
  'ZW', // Zimbabwe — OFAC SDN / sanctions list
  'SO', // Somalia — UN arms embargo
  'CF', // Central African Republic — UN arms embargo
  'LY', // Libya — UN arms embargo
  'ML', // Mali — UN arms embargo
  'NI', // Nicaragua — OFAC sectoral
  'YE', // Yemen — UN arms embargo
])

export interface SanctionsResult {
  /** Whether the country is blocked from receiving monetary rewards. */
  blocked: boolean
  /** Human-readable reason string, included in the API 403 response. */
  reason: string | null
}

/**
 * Check whether a given ISO-3166-1 alpha-2 country code is subject to
 * sanctions that would block gift-card or cash-equivalent redemptions.
 *
 * @param countryCode - Two-letter ISO country code, or null/undefined if unknown.
 * @returns `{ blocked: false }` when the country is clear, or
 *          `{ blocked: true, reason: "..." }` when blocked.
 */
export function checkSanctions(countryCode: string | null | undefined): SanctionsResult {
  if (!countryCode) {
    // Unknown country — allow (KYC gate handles the $400 threshold separately)
    return { blocked: false, reason: null }
  }

  const upper = countryCode.toUpperCase().trim()
  if (BLOCKED_COUNTRY_CODES.has(upper)) {
    return {
      blocked: true,
      reason: `Gift-card redemptions are not available in your region (${upper}) due to applicable sanctions regulations.`,
    }
  }

  return { blocked: false, reason: null }
}
