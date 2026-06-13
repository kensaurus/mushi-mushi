/**
 * FILE: apps/admin/src/components/reports/types.ts
 * PURPOSE: Shared shapes + small helpers for the ReportsPage subcomponents.
 *          Page becomes orchestration; the table, row, bulk bar, etc. all
 *          import these.
 */

import { severityLabel } from '../../lib/tokens'

export interface ReportRow {
  id: string
  project_id: string
  description: string
  category: string
  severity: string | null
  summary: string | null
  status: string
  created_at: string
  user_category: string
  confidence: number | null
  component: string | null
  /** Total reports filed against the same fingerprint (>=1). Lets the table
   *  collapse duplicate rows behind a single canonical row + "+N variants" chip. */
  dedup_count?: number
  /** COUNT(DISTINCT reporter_token_hash) for this dedup group — the real blast
   *  radius. Token hash is device-stable per the SDK, so this counts distinct
   *  devices that felt the bug (the right proxy for "people" in the anonymous
   *  reporter case). Set by /v1/admin/reports via the report_group_blast_radius
   *  RPC. */
  unique_users?: number
  /** COUNT(DISTINCT session_id) for this dedup group. Useful as a tie-breaker
   *  when a single device opens the same bug across multiple sessions. */
  unique_sessions?: number
  report_group_id?: string | null
  last_reporter_reply_at?: string | null
  last_admin_reply_at?: string | null
  // 2026-05-07 SDK observability boost — surfaced on the row so the
  // hover popover ("breadcrumb peek") and the inline tag chips can
  // render without a second round-trip when the user mouses over a row.
  breadcrumbs?: ReportBreadcrumbLite[] | null
  tags?: Record<string, string | number | boolean> | null
  sentry_trace_id?: string | null
  sentry_release?: string | null
  sentry_environment?: string | null
  // 2026-05-26 source-attribution boost. The triage row used to leave
  // the user guessing where a report came from. These five fields turn
  // the row into a self-describing "who, where, how" line so the
  // triager doesn't have to drill into the report to know if it's an
  // auto-captured server crash, a logged-in user shake-to-report,
  // or a Sentry-bridged exception from a Node service.
  sdk_package?: string | null
  sdk_version?: string | null
  /** Stable opaque user identifier passed by the host app via
   *  `Mushi.identify()` — null when the reporter is anonymous. */
  reporter_user_id?: string | null
  /** SHA256 of the device fingerprint. Used only as a fallback "who"
   *  identifier when reporter_user_id is unset; we display the first
   *  6 hex chars as a stable monogram so two reports from the same
   *  anonymous device are visibly co-attributed. */
  reporter_token_hash?: string | null
  /** Mushi auto-trigger that prompted the report (`window-error`,
   *  `unhandled-rejection`, `shake`, `dev-cli`, …). NULL = the user
   *  opened the widget themselves — the standard "felt-bug" path. */
  proactive_trigger?: string | null
  app_version?: string | null
  /** The full environment jsonb. Used by the source-cell renderer to
   *  extract `url` / `route` / `origin` (web vs node) without a second
   *  round-trip. Shape mirrors `MushiEnvironment` in the core package. */
  environment?: ReportEnvironmentLite | null
  /** Resolved display name from end_users.display_name (populated when the
   *  reporter called Mushi.identify() and the server linked the row). */
  reporter_display_name?: string | null
  /** True when end_users.jwt_verified_at is set (identity confirmed via
   *  signed JWT). Drives the verified shield in the triage row. */
  reporter_jwt_verified?: boolean
  session_id?: string | null
  end_user_id?: string | null
}

export interface ReportEnvironmentLite {
  url?: string | null
  /** Set by SDKs that compute a route from the URL (e.g. React Router
   *  match). Falls back to a path-derived value when the SDK didn't
   *  send one. */
  route?: string | null
  /** "web" | "node" | "react" | "react-native" — the SDK family. Maps
   *  cleanly to a platform glyph in the table. */
  origin?: string | null
  platform?: string | null
  userAgent?: string | null
  env?: string | null
  release?: string | null
}

/**
 * Minimal breadcrumb shape the row hover popover needs. Mirrors the
 * ReportBreadcrumb in `report-detail/types.ts` — kept loose-typed so
 * we don't bloat the table row state with the full report shape.
 */
export interface ReportBreadcrumbLite {
  timestamp: number
  category: string
  level: string
  message: string
  data?: Record<string, unknown>
}

export type SortField = 'created_at' | 'severity' | 'confidence' | 'status' | 'component'
export type SortDir = 'asc' | 'desc'

export const PAGE_SIZE = 50

/**
 * Left-edge stripe color per severity. Drawn 4px wide on the row so triage
 * scan is instant — `critical` jumps off the page in red, `low` blends in.
 */
export const SEVERITY_STRIPE: Record<string, string> = {
  critical: 'bg-danger',
  high:     'bg-warn',
  medium:   'bg-warn/60',
  low:      'bg-info',
}

export function severityStripeClass(severity: string | null): string {
  if (!severity) return 'bg-edge-subtle'
  return SEVERITY_STRIPE[severity] ?? 'bg-edge-subtle'
}

/**
 * Reports in these statuses are eligible for the inline "Dispatch fix" CTA.
 * Anything still `new` needs human triage first; anything `fixed`/`dismissed`
 * is already terminal so dispatching another attempt would just be noise.
 */
export const DISPATCH_ELIGIBLE_STATUSES = new Set(['classified', 'fixing'])

/**
 * Single-letter severity for dense scan rows — pairs with the coloured
 * stripe so `C` / `H` / `M` / `L` stays legible once triagers learn the
 * palette. Always render inside an element that sets `title` to the full
 * label so hover keeps the full form one motion away.
 */
export function severityLabelShort(s: string | null): string {
  if (!s) return '—'
  switch (s) {
    case 'critical': return 'Crit'
    case 'high':     return 'High'
    case 'medium':   return 'Med'
    case 'low':      return 'Low'
    default:         return severityLabel(s)
  }
}

export function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  // Client-supplied createdAt can land slightly in the future (clock skew).
  // Clamp so we never render "-26769s ago".
  const diff = Math.max(0, Date.now() - t)
  const sec = Math.floor(diff / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}
