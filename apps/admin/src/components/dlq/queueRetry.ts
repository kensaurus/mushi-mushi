/**
 * FILE: apps/admin/src/components/dlq/queueRetry.ts
 * PURPOSE: Queue lane deep links and which jobs may be retried.
 *
 * Retry mirrors packages/server/supabase/functions/_shared/queue-retry-policy.ts
 * (keep the two in step): failed and dead-letter jobs, plus pending or running
 * jobs stuck for 15 minutes. Completed jobs are never retried; a retry re-runs
 * classification and spends AI budget.
 */

import { STATUS_OPTIONS, type QueueItem, type StatusFilter } from './types'

const STUCK_AFTER_MS = 15 * 60_000

export function isQueueItemRetryable(item: Pick<QueueItem, 'status' | 'created_at' | 'started_at' | 'scheduled_at'>, nowMs: number): boolean {
  if (item.status === 'failed' || item.status === 'dead_letter') return true
  if (item.status === 'pending' || item.status === 'running') {
    const since = item.status === 'running' ? item.started_at : (item.scheduled_at ?? item.created_at)
    const sinceMs = since ? Date.parse(since) : Number.NaN
    return Number.isFinite(sinceMs) && nowMs - sinceMs >= STUCK_AFTER_MS
  }
  return false
}

/**
 * The lane a `/queue` link asks for. Accepts `?status=` (server topPriorityTo,
 * chart menus) and the older `?filter=`. `stalled` means pending jobs past
 * their SLA (queue stats raise it when the oldest pending job is > 15 min).
 */
export function parseQueueLaneParam(params: URLSearchParams): StatusFilter | null {
  const raw = (params.get('status') ?? params.get('filter') ?? '').trim()
  if (raw === 'stalled') return 'pending'
  return (STATUS_OPTIONS as readonly string[]).includes(raw) ? (raw as StatusFilter) : null
}
