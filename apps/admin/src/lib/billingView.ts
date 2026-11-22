/**
 * FILE: apps/admin/src/lib/billingView.ts
 * PURPOSE: Team → Billing, one source per number (round-2 review 2026-11-18).
 *
 *          The page drew numbers from two endpoints with two scopes and
 *          never said which:
 *          - /v1/admin/billing/stats counts the whole team this period
 *            (diagnoses, fixes merged), the top meters;
 *          - /v1/admin/billing `projects[].usage` and `usage_series` are one
 *            app's, so "Fixes merged 191" (team) sat next to "Fixes merged 0"
 *            (this app), and "24 / 3,000 diagnoses" (team) next to
 *            "0 reports · 0 active days" (this app).
 *          The team counts stay in the meters; the app card says "this app".
 *
 *          Seats: the billing tier object has no seat_limit (server), so the
 *          entitlement list read null as "Unlimited" next to "Seats 3 / 5".
 *          It now takes the members-stats limit the Seats meter uses.
 */

export interface SeatEntitlementInput {
  /** pricing_plans.feature_flags.teams */
  teams: boolean
  /** The seat limit the Seats meter shows (members stats, then the tier). */
  seatLimit: number | null
  /**
   * The limit came from a source that says null = no limit (members stats).
   * When false a null limit is unknown, never "Unlimited".
   */
  limitKnown: boolean
}

/** "Just you", "5", "Unlimited", or null when the limit is not known. */
export function seatEntitlementLabel({ teams, seatLimit, limitKnown }: SeatEntitlementInput): string | null {
  if (!teams) return 'Just you'
  if (seatLimit != null) return `${seatLimit}`
  return limitKnown ? 'Unlimited' : null
}

export interface AppUsageFact {
  label: string
  value: string
  /** A zero count is drawn grey. */
  zero: boolean
}

/**
 * The app card's own counts: what the team meters above don't already say.
 * Fixes merged only when the team meters are hidden (Quick mode); then it is
 * this app's count, under the app's name.
 */
export function appUsageFacts(
  usage: { tokens: number; fixes?: number; fixesSucceeded?: number },
  llmCostUsd: number | null | undefined,
  formatUsd: (n: number) => string,
  { includeFixes = false }: { includeFixes?: boolean } = {},
): AppUsageFact[] {
  const facts: AppUsageFact[] = []
  if (includeFixes) {
    // Merged fix PRs from any agent; `fixes` counts only the server agent's runs (1c802df2).
    const merged = usage.fixesSucceeded ?? usage.fixes ?? 0
    facts.push({ label: 'Fixes merged', value: merged.toLocaleString(), zero: merged <= 0 })
  }
  facts.push({ label: 'Classifier tokens', value: usage.tokens.toLocaleString(), zero: usage.tokens <= 0 })
  if (llmCostUsd != null) facts.push({ label: 'AI cost', value: formatUsd(llmCostUsd), zero: llmCostUsd <= 0 })
  return facts
}
