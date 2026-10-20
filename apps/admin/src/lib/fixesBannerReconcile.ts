/**
 * FILE: apps/admin/src/lib/fixesBannerReconcile.ts
 * PURPOSE: The Fixes status banner and snapshot read `/v1/admin/fixes/stats`,
 *          while the "Stopped dispatches — needs attention" cards below them
 *          read `/v1/admin/fixes/dispatches`. On glot.it the banner said
 *          "Fix pipeline healthy · Auto-fix stopped 0" above five red Failed
 *          cards (console audit 2026-10-20, B3). A status banner must derive
 *          from the list it sits above, so the page reconciles the server
 *          stats with the dispatches it is about to render.
 */

import type { DispatchJob } from '../components/fixes/types'
import type { FixesStats } from '../components/fixes/FixesStatsTypes'

/** Dispatch states the page shows as "needs attention". One definition. */
const DISPATCH_ATTENTION_STATUSES: ReadonlySet<DispatchJob['status']> = new Set([
  'skipped',
  'skipped_no_sandbox',
  'completed_no_pr',
  'failed',
])

type DispatchLike = Pick<DispatchJob, 'status'> & Partial<Pick<DispatchJob, 'report_id' | 'created_at'>>

/**
 * The newest dispatch for each report, in input order. A failed run that a
 * later dispatch on the same report replaced is history, not something that
 * needs attention: on tsumagoi the card "Failed — Cursor API 400" stayed
 * under "needs attention" next to the retry's open PR (2026-10-20). Rows
 * without a report id are kept as they are.
 */
function latestDispatchPerReport<T extends DispatchLike>(dispatches: readonly T[]): T[] {
  const newest = new Map<string, T>()
  for (const d of dispatches) {
    if (!d.report_id) continue
    const cur = newest.get(d.report_id)
    if (!cur || (d.created_at ?? '') > (cur.created_at ?? '')) newest.set(d.report_id, d)
  }
  const keep = new Set(newest.values())
  return dispatches.filter((d) => !d.report_id || keep.has(d))
}

/** Dispatches the page lists under "needs attention": each report's newest, if it stopped. */
export function stoppedDispatches<T extends DispatchLike>(dispatches: readonly T[]): T[] {
  return latestDispatchPerReport(dispatches).filter((d) => DISPATCH_ATTENTION_STATUSES.has(d.status))
}

/** Priorities that already outrank "something stopped": setup is missing. */
const SETUP_PRIORITIES: ReadonlySet<FixesStats['topPriority']> = new Set(['no_project', 'no_github', 'no_index'])

export function reconcileFixesStats(
  stats: FixesStats,
  dispatches: readonly DispatchLike[],
): FixesStats {
  const stopped = stoppedDispatches(dispatches).length
  if (stopped === 0) return stats
  if (SETUP_PRIORITIES.has(stats.topPriority)) return stats
  const failed = Math.max(stats.failed, stopped)
  if (stats.topPriority === 'failed' && stats.failed >= stopped) return stats
  return {
    ...stats,
    failed,
    topPriority: 'failed',
    topPriorityLabel: `${stopped} dispatch${stopped === 1 ? '' : 'es'} stopped before opening a PR — read why below, then retry or close the report.`,
    topPriorityTo: null,
  }
}
