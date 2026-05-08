/**
 * Returns true if the ISO timestamp is older than `thresholdMs`.
 * Used by integration cards to show a "Stale" badge when the last
 * probe was more than an hour ago (auto-probe runs every 15 min,
 * so anything > 1 h means the cron has missed at least 4 ticks).
 */
export function isStale(checkedAt: string | null | undefined, thresholdMs = 60 * 60 * 1000): boolean {
  if (!checkedAt) return false
  return Date.now() - new Date(checkedAt).getTime() > thresholdMs
}
