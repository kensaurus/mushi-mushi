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
