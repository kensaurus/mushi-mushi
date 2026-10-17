/**
 * Page hero metric-chip helper. The publish/subscribe snapshot store pages
 * once wrote into had no reader left and was removed on 2026-10-16; the
 * snapshot shape and its route builders followed on 2026-10-17.
 */

/** Split "3 members · 2 inactive" into display chips. */
export function heroMetricChips(metric?: string): string[] {
  if (!metric?.trim()) return []
  return metric
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean)
}
