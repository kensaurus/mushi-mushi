/**
 * FILE: apps/admin/src/lib/antiGamingReason.ts
 * PURPOSE: Show one token count on an anti-gaming device card.
 *
 * The stored multi-account sentence freezes the count from the first flag.
 * The card's token chip uses the live list. Substituting the live count
 * here keeps those two numbers the same until the next report rewrites the row.
 * Event rows name the reporter key instead of a second count, because the
 * sentence already states how many tokens the device has.
 */

import { shortReporterKey } from './reporterKey'

const MULTI_ACCOUNT_COUNT = /^(Multi-account: )\d+( reporter tokens\b)/

export function flagReasonForTokenCount(reason: string | null, tokenCount: number): string | null {
  if (!reason) return reason
  if (!Number.isInteger(tokenCount) || tokenCount < 0) return reason
  return reason.replace(MULTI_ACCOUNT_COUNT, `$1${tokenCount}$2`)
}

/** Chip label beside an event reason. Multi-account reasons already state the count. */
export function eventTokenChipText(tokens: string[], reason: string | null): string {
  if (tokens.length === 0) return '—'
  const named = `tok:${shortReporterKey(tokens[0])}…`
  if (tokens.length === 1) return named
  if (reason && MULTI_ACCOUNT_COUNT.test(reason)) return named
  return `${tokens.length} tokens`
}
