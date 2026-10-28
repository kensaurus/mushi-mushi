/**
 * FILE: apps/admin/src/lib/criticalSurfaces.ts
 * PURPOSE: Names the window and status scope of each "critical" number, and
 *          the list that number opens. The counts are different on purpose
 *          (report 7972eaee): a 14-day still-open tile, an all-time chip, an
 *          any-age decision queue, and a 30-day filing total. The label has
 *          to say which, or they read as one number.
 *
 * Server twins (the list filter each label claims):
 *   tile  — severity-stats `openBySeverity` and `GET /reports?status=unresolved&days=`
 *   chip  — `GET /v1/admin/stats` `bySeverity` and `GET /reports?severity=` with no window
 *   home  — project-home waiting counts and `GET /reports?status=open` (no window)
 *   30d   — projects list `severity_breakdown_30d` (created in 30 days, any status)
 */

/** Bugs KPI tiles use this window unless the page passes another. */
export const CRITICAL_TILE_WINDOW_DAYS = 14

export interface CriticalListFilters {
  severity: string
  status: string
  days: string
}

/** Visible tile label. The value is reports from the window that are not closed. */
export function criticalTileLabel(severityLabel: string, windowDays: number): string {
  return `${severityLabel} · ${windowDays}d still open`
}

/**
 * The tile is selected only when the list is the query it counted:
 * that severity, that window, status=unresolved (not fixed, resolved,
 * verified or dismissed).
 */
export function criticalTileActive(current: CriticalListFilters, severity: string, windowDays: number): boolean {
  return current.severity === severity && current.status === 'unresolved' && current.days === String(windowDays)
}

/** Visible chip label. The count is every report of that severity, any age, any status. */
export function criticalChipLabel(severityLabel: string): string {
  return `${severityLabel} · all time`
}

/** The chip is selected only when severity is the list's only scope filter. */
export function criticalChipActive(current: CriticalListFilters, severity: string): boolean {
  return current.severity === severity && current.status === '' && current.days === ''
}

/**
 * Params that make the list equal the chip's all-time count. Selecting
 * clears a window or status left by the tile; selecting again clears severity.
 */
export function criticalChipParams(
  current: CriticalListFilters,
  severity: string,
): Record<'severity' | 'days' | 'status', string> {
  if (criticalChipActive(current, severity)) return { severity: '', days: current.days, status: current.status }
  return { severity, days: '', status: '' }
}

export function criticalChipHint(severity: string, windowDays: number = CRITICAL_TILE_WINDOW_DAYS): string {
  return `Every ${severity} report, any age and any status. The tile above counts only those still open from the last ${windowDays} days.`
}

/** Sidebar and the app switcher: reports created in 30 days, any status. */
export function criticalFiled30dLabel(count: number): string {
  return `${count} critical ${count === 1 ? 'report' : 'reports'} filed in 30 days`
}
