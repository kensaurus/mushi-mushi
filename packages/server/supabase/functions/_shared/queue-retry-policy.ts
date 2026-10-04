/**
 * FILE: packages/server/supabase/functions/_shared/queue-retry-policy.ts
 * PURPOSE: Which processing_queue jobs a person may retry by hand.
 *
 * A retry resets the job and re-runs classification, which costs LLM budget
 * and can overwrite existing triage. The console used to offer Retry on every
 * lane, so one click on "Retry page" re-classified 25 completed reports.
 *
 *   failed / dead_letter        retry (that is what the button is for)
 *   pending / running, stuck    retry once it has waited STUCK_AFTER_MS, so a
 *                               job stuck mid-flight can still be recovered
 *   pending / running, fresh    no: the worker is on it, a retry would run it twice
 *   completed                   no: already triaged
 *
 * The admin console keeps a copy of this rule in
 * apps/admin/src/components/dlq/queueRetry.ts; keep the two in step.
 */

export const STUCK_AFTER_MS = 15 * 60_000

export interface RetryCandidate {
  status: string
  created_at?: string | null
  started_at?: string | null
  scheduled_at?: string | null
}

export function queueRetryDenial(item: RetryCandidate, nowMs: number): string | null {
  if (item.status === 'failed' || item.status === 'dead_letter') return null
  if (item.status === 'pending' || item.status === 'running') {
    const since = item.status === 'running' ? item.started_at : (item.scheduled_at ?? item.created_at)
    const sinceMs = since ? Date.parse(since) : Number.NaN
    if (Number.isFinite(sinceMs) && nowMs - sinceMs >= STUCK_AFTER_MS) return null
    return item.status === 'running'
      ? 'This job is running right now. Retry it only if it is still running in 15 minutes.'
      : 'This job is waiting for the worker. Retry it only if it is still waiting in 15 minutes.'
  }
  if (item.status === 'completed') {
    return 'This job already finished. Retrying it would re-run triage and spend AI budget.'
  }
  return 'Only failed or stuck jobs can be retried.'
}
