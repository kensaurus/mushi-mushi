/**
 * FILE: apps/admin/src/lib/antiGamingReason.ts
 * PURPOSE: Show one token count on an anti-gaming card.
 *
 * The stored multi-account sentence freezes the count from the first flag.
 * The device card's token chip uses the live list. Substituting the live
 * count here keeps those two numbers the same for rows the next report has
 * not rewritten yet. The clause (same device vs scripted client) stays.
 *
 * Mirrors `alignMultiAccountReason` in
 * packages/server/supabase/functions/_shared/anti-gaming.ts.
 */

const MULTI_ACCOUNT_COUNT = /^(Multi-account: )\d+( reporter tokens\b)/

export function flagReasonForTokenCount(reason: string | null, tokenCount: number): string | null {
  if (!reason) return reason
  if (!Number.isInteger(tokenCount) || tokenCount < 0) return reason
  return reason.replace(MULTI_ACCOUNT_COUNT, `$1${tokenCount}$2`)
}
