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
  /** Number of reports in the same dedup group (>=1). When >1 we render a
   *  "+N similar" badge so triagers can scan past duplicates instead of
   *  reading 5 visually-identical rows. */
  dedup_count?: number
  report_group_id?: string | null
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

export function severityLabelShort(s: string | null): string {
  if (!s) return '—'
  return severityLabel(s)
}

export function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  const sec = Math.round(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}
