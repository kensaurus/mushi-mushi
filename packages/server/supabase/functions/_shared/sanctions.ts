// ── sanctions.ts — OFAC/sanctions geofence for Mushi Bounties ────────────────
//
// Tango paid OFAC a $116K penalty in 2022 for sending gift cards to
// sanctioned regions. This module provides defense-in-depth: reject
// tester signups and gift-card redemptions before they reach Tremendous.
//
// Country codes follow ISO 3166-1 alpha-2. The list is intentionally
// conservative — err on the side of blocking.
//
// Sources:
//   - OFAC Specially Designated Nationals List (SDN)
//   - Executive Order 13685 (Ukraine / Crimea)
//   - Executive Order 13694 (DPRK)
//   - Executive Order 13599 (Iran)
//   - 31 CFR Part 515 (Cuba)
//   - Executive Order 13582 (Syria)
//   - Tango OFAC Settlement (2022) post-mortem
//
// This list must be reviewed and updated quarterly. Document the review
// date in docs/runbooks/tester-marketplace-launch.md.

export const OFAC_DENIED_COUNTRIES = new Set<string>([
  'CU', // Cuba
  'IR', // Iran
  'KP', // North Korea (DPRK)
  'SY', // Syria
  // Ukraine: Crimea region — can't geo-fence at country level, see notes below
  // Belarus — not currently on SDN but add when escalated
  'RU', // Russia (added post-2022 invasion comprehensive sanctions by US/EU)
  'BY', // Belarus (Lukashenko regime sanctions)
])

// Sub-national regions that are OFAC-blocked within otherwise-allowed countries.
// Mushi cannot currently geofence these precisely — add a reviewer note for
// any redemption from countries where sub-national blocks apply.
export const OFAC_REGION_NOTES: Record<string, string> = {
  UA: 'Crimea, Donetsk, Luhansk regions are OFAC-blocked. Manual review required.',
  CN: 'Review for SDN individuals. No country-level block in force.',
}

export interface SanctionsCheckResult {
  blocked: boolean
  reason?: string
  requiresReview?: boolean
  reviewNote?: string
}

/**
 * Check whether a country code is OFAC-blocked for Mushi Bounties redemptions.
 * Call this before processing any gift-card redemption or tester signup.
 */
export function checkSanctions(countryCode: string | null): SanctionsCheckResult {
  if (!countryCode) {
    // Unknown country — allow but flag for manual review on large redemptions.
    return { blocked: false, requiresReview: true, reviewNote: 'Unknown country code — manual review recommended for gift-card redemptions.' }
  }

  const upper = countryCode.toUpperCase()

  if (OFAC_DENIED_COUNTRIES.has(upper)) {
    return {
      blocked: true,
      reason: `Tester country ${upper} is on the OFAC sanctions list. Gift-card redemptions are not available.`,
    }
  }

  const regionNote = OFAC_REGION_NOTES[upper]
  if (regionNote) {
    return {
      blocked: false,
      requiresReview: true,
      reviewNote: regionNote,
    }
  }

  return { blocked: false }
}

/**
 * Validate a tester country for signup purposes.
 * Softer than `checkSanctions` — allows signup but flags the account.
 */
export function isTesterCountryAllowed(countryCode: string | null): boolean {
  if (!countryCode) return true // allow unknown; flag later
  return !OFAC_DENIED_COUNTRIES.has(countryCode.toUpperCase())
}
