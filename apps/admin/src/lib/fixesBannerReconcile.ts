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
export const DISPATCH_ATTENTION_STATUSES: ReadonlySet<DispatchJob['status']> = new Set([
  'skipped',
  'skipped_no_sandbox',
  'completed_no_pr',
  'failed',
])

function stoppedDispatchCount(dispatches: readonly Pick<DispatchJob, 'status'>[]): number {
  return dispatches.filter((d) => DISPATCH_ATTENTION_STATUSES.has(d.status)).length
}

/** Priorities that already outrank "something stopped": setup is missing. */
const SETUP_PRIORITIES: ReadonlySet<FixesStats['topPriority']> = new Set(['no_project', 'no_github', 'no_index'])

export function reconcileFixesStats(
  stats: FixesStats,
  dispatches: readonly Pick<DispatchJob, 'status'>[],
): FixesStats {
  const stopped = stoppedDispatchCount(dispatches)
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
