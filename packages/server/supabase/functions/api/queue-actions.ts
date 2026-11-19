/**
 * FILE: packages/server/supabase/functions/api/queue-actions.ts
 * PURPOSE: The triage queue's write actions, in one place, for every route
 *          that offers them:
 *
 *            resetQueueJob        the DLQ row's Retry (routes/queue.ts) and the
 *                                 report page's per-stage retry
 *            applyTriageRetry     the report page's "Retry triage"
 *                                 (routes/report-pipeline.ts), compare-and-set
 *            recoverStranded      "Recover stranded" (routes/queue.ts) and the
 *                                 Health page's "Run recovery now"
 *                                 (routes/health.ts), scoped to the caller's apps
 *
 *          `recoverStranded` mirrors the `mushi-pipeline-recovery-5m` pg_cron
 *          (recover_stranded_pipeline()), but only for the project ids it is
 *          given. Never call that SQL function from a request: it is SECURITY
 *          DEFINER and recovers every tenant.
 *
 *          Who may act, rate limits and the retry rule
 *          (_shared/queue-retry-policy.ts, _shared/report-pipeline-trail.ts
 *          triageRetryDecision) stay in the routes.
 */

import type { getServiceClient } from '../_shared/db.ts'
import type { TrailQueueRow, TrailReportRow } from '../_shared/report-pipeline-trail.ts'

type Db = ReturnType<typeof getServiceClient>

/** Fires fast-filter for a report (api/helpers.ts triggerClassification). */
export type TriggerClassification = (reportId: string, projectId: string) => void

/**
 * Put one job back to `pending` so the worker takes it again. With
 * `expectStatus`, only a row still in that status is reset (compare-and-set):
 * `reset` is false when another request got there first.
 */
export async function resetQueueJob(
  db: Db,
  jobId: string,
  opts: { now: Date; expectStatus?: string },
): Promise<{ reset: boolean; error: string | null }> {
  const patch = {
    status: 'pending',
    attempts: 0,
    last_error: null,
    scheduled_at: opts.now.toISOString(),
  }
  if (!opts.expectStatus) {
    const { error } = await db.from('processing_queue').update(patch).eq('id', jobId)
    return { reset: !error, error: error?.message ?? null }
  }
  const { data, error } = await db
    .from('processing_queue')
    .update({ ...patch, started_at: null, completed_at: null })
    .eq('id', jobId)
    .eq('status', opts.expectStatus)
    .select('id')
  if (error) return { reset: false, error: error.message }
  return { reset: Array.isArray(data) && data.length > 0, error: null }
}

export type TriageRetryOutcome =
  | { outcome: 'queued'; message: string }
  | { outcome: 'already'; message: string }
  | { outcome: 'error'; message: string }

/**
 * Re-run triage for one report after `triageRetryDecision` said `retry`.
 * Resets its stage-1 job (compare-and-set on the status it was read in), or
 * creates the job when there is none, then fires fast-filter once. A second
 * click that loses the race fires nothing.
 */
export async function applyTriageRetry(
  db: Db,
  input: { report: Pick<TrailReportRow, 'id' | 'status'>; projectId: string; job: TrailQueueRow | null },
  trigger: TriggerClassification,
  now: Date,
): Promise<TriageRetryOutcome> {
  const { report, projectId, job } = input
  if (job) {
    const res = await resetQueueJob(db, job.id, { now, expectStatus: job.status })
    if (res.error) return { outcome: 'error', message: 'Could not reset the triage job. Try again in a moment.' }
    if (!res.reset) return { outcome: 'already', message: 'Someone retried this a moment ago; triage is running.' }
  } else {
    const { error } = await db
      .from('processing_queue')
      .insert({ report_id: report.id, project_id: projectId, stage: 'stage1', status: 'pending', scheduled_at: now.toISOString() })
    if (error) {
      if (error.code === '23505') return { outcome: 'already', message: 'Someone retried this a moment ago; triage is running.' }
      return { outcome: 'error', message: 'Could not queue the report for triage. Try again in a moment.' }
    }
  }
  // A report held by the circuit breaker sits in `queued`; recover does the same.
  if (report.status === 'queued') {
    await db.from('reports').update({ status: 'new' }).eq('id', report.id).eq('status', 'queued')
  }
  trigger(report.id, projectId)
  return { outcome: 'queued', message: 'Triage is running again. This page updates when it finishes.' }
}

export interface RecoverResult {
  /** Reports re-sent to triage (stuck in new/queued for 5+ minutes, under 3 attempts). */
  reports: number
  /** Failed queue jobs with attempts left, put back to pending. */
  queue: number
  /** Pending jobs whose report was already triaged, closed as completed. */
  reconciled: number
  /** Re-sent report count per project, for the audit log. */
  reportsByProject: Map<string, number>
}

/** Recover the triage pipeline for these projects only (bounded: 50 reports, 50 jobs, 100 reconciles). */
export async function recoverStranded(
  db: Db,
  projectIds: readonly string[],
  trigger: TriggerClassification,
  now: Date,
): Promise<RecoverResult> {
  const reportsByProject = new Map<string, number>()
  if (projectIds.length === 0) return { reports: 0, queue: 0, reconciled: 0, reportsByProject }
  const ids = [...projectIds]

  const cutoff = new Date(now.getTime() - 5 * 60_000).toISOString()
  const { data: stranded } = await db
    .from('reports')
    .select('id, project_id, status')
    .in('project_id', ids)
    .in('status', ['new', 'queued'])
    .lt('created_at', cutoff)
    .lt('processing_attempts', 3)
    .order('created_at', { ascending: true })
    .limit(50)

  const items = (stranded ?? []) as Array<{ id: string; project_id: string; status: string }>
  for (const r of items) {
    if (r.status === 'queued') {
      await db.from('reports').update({ status: 'new' }).eq('id', r.id)
    }
    trigger(r.id, r.project_id)
    reportsByProject.set(r.project_id, (reportsByProject.get(r.project_id) ?? 0) + 1)
  }

  const { data: failed } = await db
    .from('processing_queue')
    .select('id, report_id, project_id, attempts, max_attempts')
    .in('project_id', ids)
    .eq('status', 'failed')
    .order('created_at', { ascending: true })
    .limit(50)

  const retryable = ((failed ?? []) as Array<{ id: string; report_id: string; project_id: string; attempts: number | null; max_attempts: number | null }>).filter(
    (f) => (f.attempts ?? 0) < (f.max_attempts ?? 3),
  )
  for (const q of retryable) {
    await db
      .from('processing_queue')
      .update({
        status: 'pending',
        scheduled_at: now.toISOString(),
      })
      .eq('id', q.id)
    trigger(q.report_id, q.project_id)
  }

  const { data: stale } = await db
    .from('processing_queue')
    .select('id, reports!inner(status)')
    .in('project_id', ids)
    .eq('status', 'pending')
    .in('reports.status', ['classified', 'dispatched', 'completed'])
    .limit(100)

  const reconcileIds = ((stale ?? []) as Array<{ id: string }>).map((s) => s.id)
  if (reconcileIds.length > 0) {
    await db
      .from('processing_queue')
      .update({
        status: 'completed',
        completed_at: now.toISOString(),
      })
      .in('id', reconcileIds)
  }

  return { reports: items.length, queue: retryable.length, reconciled: reconcileIds.length, reportsByProject }
}

/** "Re-sent 3 reports, retried 1 job, closed 2 finished jobs" — or "Nothing was stuck". */
export function recoverSummary(r: Pick<RecoverResult, 'reports' | 'queue' | 'reconciled'>): string {
  const parts: string[] = []
  if (r.reports > 0) parts.push(`re-sent ${r.reports} stuck report${r.reports === 1 ? '' : 's'} to triage`)
  if (r.queue > 0) parts.push(`retried ${r.queue} failed job${r.queue === 1 ? '' : 's'}`)
  if (r.reconciled > 0) parts.push(`closed ${r.reconciled} job${r.reconciled === 1 ? '' : 's'} that had already finished`)
  if (parts.length === 0) return 'Nothing was stuck; nothing to recover.'
  const s = parts.join(', ')
  return `${s[0]!.toUpperCase()}${s.slice(1)}.`
}
