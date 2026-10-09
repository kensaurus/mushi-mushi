/**
 * FILE: apps/admin/src/lib/reportsListFilters.ts
 * PURPOSE: The /reports filter vocabulary in one place: what each chip,
 *          select and KPI tile sends, what it is called, and how its count is
 *          read, so a count always equals the list it opens (2026-10-04
 *          console audit, group B). Server twin:
 *          packages/server/supabase/functions/_shared/report-list-filters.ts.
 */

import { ORIGIN_FILTER_OPTIONS } from './reportOrigin'

/** Stats shape from GET /v1/admin/stats that the quick-filter chips read. */
export interface ReportStatusStats {
  total?: number
  /** Reports still waiting on a decision — the `open` chip. */
  openCount?: number
  /** Stored statuses folded into the canonical buckets (pending/submitted → new). */
  byStatus?: Record<string, number>
  bySeverity?: Record<string, number>
}

/**
 * Chip count for a status filter — the rows `GET /v1/admin/reports?status=`
 * lists. `status=new` lists new + queued (+ pending/submitted, which the stats
 * route already folds into `new`), so the New chip adds queued.
 */
export function statusChipCount(value: string, stats: ReportStatusStats): number {
  const byStatus = stats.byStatus ?? {}
  if (value === '') return stats.total ?? 0
  if (value === 'open') return stats.openCount ?? 0
  if (value === 'new') return (byStatus.new ?? 0) + (byStatus.queued ?? 0)
  return byStatus[value] ?? 0
}

/**
 * Status quick chips — the list's only status filter (the Status select was
 * dropped as a duplicate). `active` stays reachable from the severity tiles.
 */
export const STATUS_CHIPS: ReadonlyArray<{
  value: string
  label: string
  tone: 'default' | 'warn' | 'info' | 'brand' | 'ok'
}> = [
  { value: '', label: 'All', tone: 'default' },
  // Everything still waiting on a decision — what the dashboard's Bug queue
  // previews and its "View backlog" link opens.
  { value: 'open', label: 'Open', tone: 'warn' },
  { value: 'new', label: 'New', tone: 'warn' },
  { value: 'classified', label: 'Classified', tone: 'brand' },
  { value: 'fixing', label: 'Fixing', tone: 'info' },
  { value: 'fixed', label: 'Fixed', tone: 'ok' },
  { value: 'verified', label: 'Verified', tone: 'ok' },
  { value: 'reopened', label: 'Reopened', tone: 'warn' },
  { value: 'dismissed', label: 'Dismissed', tone: 'default' },
]

/**
 * Severity quick chips — the list's only severity filter. Values are stored
 * severities (critical | high | medium | low); the second chip used to send
 * `major`, which no report has.
 */
export const SEVERITY_CHIPS: ReadonlyArray<{ value: string; label: string; tone: 'warn' | 'danger' | 'info' | 'default' }> = [
  { value: 'critical', label: 'Critical', tone: 'danger' },
  { value: 'high', label: 'High', tone: 'warn' },
  { value: 'medium', label: 'Medium', tone: 'info' },
  { value: 'low', label: 'Low', tone: 'default' },
]

const STATUS_FILTER_LABELS: Record<string, string> = {
  open: 'Open (needs a decision)',
  active: 'Not dismissed',
  new: 'New',
  queued: 'Queued',
  classified: 'Classified',
  fixing: 'Fixing',
  fixed: 'Fixed',
  verified: 'Verified',
  reopened: 'Reopened',
  dismissed: 'Dismissed',
}

export function statusFilterLabel(value: string): string {
  return STATUS_FILTER_LABELS[value] ?? value
}

/**
 * Platform filter. The server matches the values SDKs really send
 * (React Native `ios`/`android`, browser `iPhone`/`Win32`/`MacIntel`, Sentry
 * `javascript`); "Web" also matches anything the web SDK stamped.
 */
export const PLATFORM_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'ios', label: 'iOS' },
  { value: 'android', label: 'Android' },
  { value: 'web', label: 'Web' },
  { value: 'macos', label: 'macOS' },
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
]

/**
 * SDK filter. Only these two packages stamp reports: the React, Vue,
 * Svelte, Angular and Capacitor wrappers all report as the web SDK.
 */
export const SDK_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '@mushi-mushi/web', label: 'Web SDK (React, Vue, Capacitor…)' },
  { value: '@mushi-mushi/react-native', label: 'React Native' },
]

const SDK_FILTER_ALIASES: Record<string, string> = {
  '@mushi-mushi/react': '@mushi-mushi/web',
  '@mushi-mushi/vue': '@mushi-mushi/web',
  '@mushi-mushi/svelte': '@mushi-mushi/web',
  '@mushi-mushi/angular': '@mushi-mushi/web',
  '@mushi-mushi/capacitor': '@mushi-mushi/web',
}

/**
 * URL filter values the list can apply. Old saved views and bookmarks carry
 * SDK values the console no longer offers (React, Capacitor: both report as
 * the web SDK) or values that never existed; an unknown one is dropped
 * rather than sent, so a stale link still opens a list instead of an error.
 */
export function sanitizeListFilters(raw: { platform: string; sdkPackage: string; days: string; origin?: string }): {
  platform: string
  sdkPackage: string
  days: string
  origin: string
} {
  const platform = PLATFORM_FILTER_OPTIONS.some((o) => o.value === raw.platform) ? raw.platform : ''
  const sdk = SDK_FILTER_ALIASES[raw.sdkPackage] ?? raw.sdkPackage
  const sdkPackage = SDK_FILTER_OPTIONS.some((o) => o.value === sdk) ? sdk : ''
  const n = Number(raw.days)
  const days = raw.days && Number.isInteger(n) && n >= 1 && n <= 90 ? String(n) : ''
  const origin = ORIGIN_FILTER_OPTIONS.some((o) => o.value === raw.origin) ? raw.origin! : ''
  return { platform, sdkPackage, days, origin }
}

export function optionLabel(options: ReadonlyArray<{ value: string; label: string }>, value: string): string {
  return options.find((o) => o.value === value)?.label ?? value
}

/**
 * URL params a severity KPI tile sets: the tile counts non-dismissed reports
 * of that severity created in the last `windowDays` (severity-stats route),
 * so the list it opens applies exactly those three filters. `null` clears.
 */
export function kpiTileFilter(
  severity: string | null,
  windowDays: number,
  current: { status: string; days: string } = { status: '', days: '' },
): Record<'severity' | 'days' | 'status', string> {
  if (severity) return { severity, days: String(windowDays), status: 'active' }
  // Clearing the tile removes only what the tile set; a status or window
  // the user picked afterwards stays.
  return {
    severity: '',
    status: current.status === 'active' ? '' : current.status,
    days: current.days === String(windowDays) ? '' : current.days,
  }
}

/** Default direction on a column's first click. Severity: worst first. */
export function defaultSortDir(field: string): 'asc' | 'desc' {
  return field === 'created_at' || field === 'severity' ? 'desc' : 'asc'
}

/**
 * Link to every report from this report's reporter, or null when it has
 * none (integration and Sentry imports). Identified users filter by the
 * durable end_users FK; anonymous reporters by the per-device token hash.
 */
export function reporterReportsHref(report: {
  end_user_id?: string | null
  reporter_token_hash?: string | null
}): string | null {
  if (report.end_user_id) return `/reports?end_user=${encodeURIComponent(report.end_user_id)}`
  if (report.reporter_token_hash) return `/reports?reporter=${encodeURIComponent(report.reporter_token_hash)}`
  return null
}

/**
 * Confirm copy for a bulk change that messages reporters (dismiss, or a
 * status of dismissed / fixed). Undo restores the status only: the notices
 * have already gone out, so the dialog says so before anything is sent.
 */
export function bulkConfirmCopy(
  pending: { action: 'set_status' | 'set_severity' | 'dismiss'; value?: string },
  count: number,
): { title: string; body: string; confirmLabel: string } {
  const n = `${count} report${count === 1 ? '' : 's'}`
  if (pending.action === 'set_status' && pending.value === 'fixed') {
    return {
      title: `Mark ${n} fixed?`,
      body: 'Each reporter is told their bug is fixed. Undo puts the status back, but it cannot take those messages back.',
      confirmLabel: 'Mark fixed',
    }
  }
  return {
    title: `Dismiss ${n}?`,
    body: 'Each reporter gets the message below. Undo puts the status back, but it cannot take those messages back.',
    confirmLabel: 'Dismiss',
  }
}
