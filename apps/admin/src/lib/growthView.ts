/**
 * FILE: apps/admin/src/lib/growthView.ts
 * PURPOSE: Pure display rules for Home → Growth (round-2 sweep 2026-11-18).
 *
 *   The funnel endpoint returns its weeks newest first, but the page read
 *   them as oldest first: the tiles showed the OLDEST week ("Signups 0, week
 *   of Sep 28") and the chart ran right to left ("Nov 16 … Sep 28"), while
 *   the table claimed "Newest week first" over Sep 28 at the top. One sort at
 *   the edge fixes all three: weeks are put oldest → newest here, whatever
 *   order the server sends.
 */

export interface WeekStart {
  /** ISO week start (YYYY-MM-DD). */
  week_start: string
}

/** Weeks oldest → newest (time left → right), independent of the server's order. */
export function orderWeeksAscending<T extends WeekStart>(weeks: readonly T[]): T[] {
  return [...weeks].sort((a, b) => a.week_start.localeCompare(b.week_start))
}

/** The stages that are not 0 in every week: all-zero columns ("Fix pulled", "Habit", "Paid") are hidden. */
export function stagesWithData<K extends string>(stages: readonly K[], weeks: ReadonlyArray<Partial<Record<K, number>>>): K[] {
  return stages.filter((s) => weeks.some((w) => (w[s] ?? 0) > 0))
}

/** True when a series has nothing to draw: a 0–0 axis is an empty chart. */
export function isAllZero(values: readonly number[]): boolean {
  return values.every((v) => !v)
}

/** "2026-11-18" (or an ISO timestamp) → "Nov 18": one date format on the page. */
export function shortDay(iso: string): string {
  // A bare date is a UTC day (the RPCs bucket by UTC); a timestamp is shown in local time.
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const d = new Date(bare ? `${iso}T00:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(bare ? { timeZone: 'UTC' } : {}) })
}

/** "Nov 18, 10:27 PM" for a timestamp, in the same short-date format as the tables. */
export function shortDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${shortDay(iso)}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}
