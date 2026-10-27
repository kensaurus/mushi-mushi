// ============================================================
// reporter-update-funnel.ts — did the people who reported bugs hear back?
//
// The console's Reporter updates page (console journeys 2026-10-27) leads
// with a funnel counted in bug reports, not messages:
//   told    — reports whose reporter was sent at least one update
//             (held and discarded Outbox rows never reached them);
//   opened  — of those, reports where the reporter opened an update;
//   replied — of those told, reports where the reporter wrote back after
//             the first update (reports.last_reporter_reply_at).
// ============================================================

import type { getServiceClient } from './db.ts'

export interface ReporterUpdateFunnel {
  told: number
  opened: number
  replied: number
}

export interface FunnelNotificationRow {
  report_id: string | null
  read_at: string | null
  created_at: string
  status?: string | null
}

/** Pure: reports told / opened, and the first update each report got. */
export function toldReports(rows: readonly FunnelNotificationRow[]): { firstToldAt: Map<string, string>; opened: Set<string> } {
  const firstToldAt = new Map<string, string>()
  const opened = new Set<string>()
  for (const r of rows) {
    if (!r.report_id || r.status === 'held' || r.status === 'discarded') continue
    const prev = firstToldAt.get(r.report_id)
    if (!prev || r.created_at < prev) firstToldAt.set(r.report_id, r.created_at)
    if (r.read_at) opened.add(r.report_id)
  }
  return { firstToldAt, opened }
}

/** Pure: the funnel, given each told report's last reporter reply (or null). */
export function reporterUpdateFunnel(
  rows: readonly FunnelNotificationRow[],
  lastReplyAt: ReadonlyMap<string, string | null>,
): ReporterUpdateFunnel {
  const { firstToldAt, opened } = toldReports(rows)
  let replied = 0
  for (const [reportId, toldAt] of firstToldAt) {
    const reply = lastReplyAt.get(reportId)
    if (reply && reply >= toldAt) replied += 1
  }
  return { told: firstToldAt.size, opened: opened.size, replied }
}

const REPLY_CHUNK = 100

type Db = ReturnType<typeof getServiceClient>

/**
 * The funnel for these notification rows: reads each told report's last
 * reporter reply in chunks (an `in` list stays short). `null` when a read
 * fails, so the console says the funnel is unknown instead of "0 replied".
 */
export async function readReporterUpdateFunnel(db: Db, rows: readonly FunnelNotificationRow[]): Promise<ReporterUpdateFunnel | null> {
  const ids = [...toldReports(rows).firstToldAt.keys()]
  const lastReplyAt = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += REPLY_CHUNK) {
    const chunk = ids.slice(i, i + REPLY_CHUNK)
    const { data, error } = await db.from('reports').select('id, last_reporter_reply_at').in('id', chunk)
    if (error) return null
    for (const r of (data ?? []) as Array<{ id: string; last_reporter_reply_at: string | null }>) {
      lastReplyAt.set(r.id, r.last_reporter_reply_at)
    }
  }
  return reporterUpdateFunnel(rows, lastReplyAt)
}
