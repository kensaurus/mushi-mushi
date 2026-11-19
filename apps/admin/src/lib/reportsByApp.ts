/**
 * FILE: apps/admin/src/lib/reportsByApp.ts
 * PURPOSE: /reports in All apps mode, one block per app (console 2026-11-19:
 *          "group … data of project and app so it's easier to read"). The page
 *          orders its rows with `orderReportsByApp` so the keyboard cursor
 *          (j/k/Enter, `reports[cursor]`) walks the rows in the order they are
 *          drawn; ReportsTable then cuts that list into AppGroupSections.
 *
 *          The app with the most urgent open bug comes first; inside an app the
 *          rows keep the sort the person chose (the server's order). Grouping
 *          covers the page the server sent, not every page.
 */

import { groupByApp, type AppGroup } from './groupByApp'
import type { RunStatus } from '../components/signal/StatusMark'

export interface ReportForGrouping {
  id: string
  project_id: string
  project_name?: string | null
  status: string
  severity: string | null
}

const CLOSED = new Set(['fixed', 'verified', 'resolved', 'completed', 'dismissed'])
const UNTRIAGED = new Set(['new', 'queued', 'submitted', 'pending', 'reopened'])
const FIXING = new Set(['fixing', 'dispatched'])

/** Lower is more urgent: open critical, open high, untriaged, other open, fixing, closed. */
export function reportUrgencyRank(r: Pick<ReportForGrouping, 'status' | 'severity'>): number {
  const status = (r.status ?? '').toLowerCase()
  if (CLOSED.has(status)) return 5
  if (FIXING.has(status)) return 4
  const sev = (r.severity ?? '').toLowerCase()
  if (sev === 'critical') return 0
  if (sev === 'high') return 1
  if (UNTRIAGED.has(status)) return 2
  return 3
}

/** A report's state for the app header's chips. */
export function reportRunStatus(r: Pick<ReportForGrouping, 'status' | 'severity'>): RunStatus {
  const rank = reportUrgencyRank(r)
  const status = (r.status ?? '').toLowerCase()
  if (rank <= 1) return 'failed'
  if (rank === 2) return 'waiting'
  if (rank === 4) return 'running'
  if (rank === 5) return status === 'dismissed' ? 'cancelled' : 'passed'
  return 'idle'
}

/** Words beside each chip: "✕ 2 urgent  ◷ 5 new  ● 1 fixing  ✓ 3 fixed". */
export const REPORT_COUNT_LABELS: Partial<Record<RunStatus, string>> = {
  failed: 'urgent',
  waiting: 'new',
  running: 'fixing',
  idle: 'open',
  passed: 'fixed',
  cancelled: 'closed',
}

/** The page's rows as app groups: worst app first, rows in the order given. */
export function reportAppGroups<T extends ReportForGrouping>(reports: readonly T[]): AppGroup<T>[] {
  const ranked = groupByApp(reports, (r) => ({ id: r.project_id, name: r.project_name }), { rank: reportUrgencyRank })
  // groupByApp sorts rows by rank inside a group; keep the person's sort instead.
  return ranked.map((g) => ({ ...g, items: reports.filter((r) => g.items.includes(r)) }))
}

/** The rows in drawn order (app blocks, then each block's rows), for the cursor. */
export function orderReportsByApp<T extends ReportForGrouping>(reports: readonly T[]): T[] {
  return reportAppGroups(reports).flatMap((g) => g.items)
}

/** Header chip counts for one app's rows. */
export function reportAppCounts(items: readonly Pick<ReportForGrouping, 'status' | 'severity'>[]): Partial<Record<RunStatus, number>> {
  const out: Partial<Record<RunStatus, number>> = {}
  for (const r of items) {
    const s = reportRunStatus(r)
    out[s] = (out[s] ?? 0) + 1
  }
  return out
}
