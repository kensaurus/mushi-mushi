/**
 * FILE: apps/admin/src/lib/format.ts
 * PURPOSE: Tiny string-formatting helpers shared across the admin UI. Keep
 *          this file dependency-free and pure so it can be reused inside any
 *          component or hook without setup.
 */

/**
 * Pluralize a noun based on a count. Works with both regular ("report" →
 * "reports") and irregular ("attempt" → "attempts") plurals — pass the plural
 * form explicitly when it isn't `${single}s`.
 *
 * Examples:
 *   pluralize(1, 'report')          // 'report'
 *   pluralize(0, 'report')          // 'reports'
 *   pluralize(2, 'attempt')         // 'attempts'
 *   pluralize(1, 'fix', 'fixes')    // 'fix'
 *   pluralize(2, 'fix', 'fixes')    // 'fixes'
 */
export function pluralize(count: number, single: string, plural?: string): string {
  if (count === 1) return single
  return plural ?? `${single}s`
}

/** Pluralize and prefix with the count: `2 reports`, `1 fix`. */
export function pluralizeWithCount(count: number, single: string, plural?: string): string {
  return `${count} ${pluralize(count, single, plural)}`
}

/**
 * Format a USD amount with adaptive precision so a $0.0001 Haiku ping still
 * surfaces but a $42 month reads cleanly. Used by every LLM-cost surface in
 * the admin (Billing, Prompt Lab, Health) so all three pages render the same
 * shape.
 *
 * Buckets:
 *   null/undefined → '—'
 *   exactly 0      → '$0.00'
 *   <$0.0001       → '<$0.0001' (avoid scientific notation for tiny pings)
 *   <$0.01         → 4 decimals  ('$0.0042')
 *   <$1            → 3 decimals  ('$0.123')
 *   else           → 2 decimals  ('$42.00')
 */
export function formatLlmCost(usd: number | null | undefined): string {
  if (usd == null) return '—'
  if (usd === 0) return '$0.00'
  if (usd < 0.0001) return '<$0.0001'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}
