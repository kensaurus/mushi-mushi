/**
 * FILE: packages/server/supabase/functions/api/routes/report-pipeline.ts
 * PURPOSE: One report's pipeline trail and its triage retry, for the report
 *          page's Pipeline strip (console, 2026-11-19: "when a report is stuck
 *          or failed, show which stage, how long each took, the error in plain
 *          words, and a button that retries that stage").
 *
 *   GET  /v1/admin/reports/:id/pipeline        the trail (_shared/report-pipeline-trail.ts)
 *   POST /v1/admin/reports/:id/pipeline/retry  { stage: 'triage' } re-runs fast-filter → classify-report
 *
 *   The retry is for members (viewers are refused), rate-limited per person,
 *   and idempotent: a job the worker already has answers "already running"
 *   and fires nothing, and the job reset is a compare-and-set, so a double
 *   click spends AI budget once. Order: auth → validate → decide → rate limit
 *   → compare-and-set → trigger. A rate-limit backend failure refuses (503);
 *   it never lets the call through.
 *
 *   The other stages' retries already have routes, which the strip calls:
 *   the fix → POST /v1/admin/fixes/dispatch, CI → POST /v1/admin/pipeline/actions
 *   (ci_repair).
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { canAccessReportProject, dbError, parseUuidParam, userCanAccessProject } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import { triggerClassification } from '../helpers.ts'
import { applyTriageRetry, type TriggerClassification } from '../queue-actions.ts'
import {
  buildReportTrail,
  triageRetryDecision,
  TRAIL_FIX_COLUMNS,
  TRAIL_QUEUE_COLUMNS,
  TRAIL_REPORT_COLUMNS,
  type TrailDeployRow,
  type TrailFixRow,
  type TrailQueueRow,
  type TrailReportRow,
} from '../../_shared/report-pipeline-trail.ts'

type Db = ReturnType<typeof getServiceClient>
type Ctx = Context<{ Variables: Variables }>

/** Retries one person may start per hour, across reports. */
export const TRIAGE_RETRY_PER_HOUR = 30
export const TRIAGE_RETRY_RATE_SCOPE = 'report_pipeline_retry'
/** Stages whose retry this route runs; `diagnosis` re-runs the same chain. */
const TRIAGE_STAGES = new Set(['triage', 'diagnosis'])

export interface ReportPipelineDeps {
  now: () => Date
  trigger: TriggerClassification
}

const defaultDeps: ReportPipelineDeps = {
  now: () => new Date(),
  trigger: (reportId, projectId) => triggerClassification(reportId, projectId),
}

/**
 * The report by id, then its app checked (canAccessReportProject), as the
 * other detail routes do: the console's pinned app must not hide a report of
 * another app the caller can open.
 */
async function loadReport(c: Ctx, db: Db, reportId: string): Promise<{ report: TrailReportRow & { project_id: string } } | { response: Response }> {
  const userId = c.get('userId') as string
  const notFound = () => ({ response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404) })
  const { data, error } = await db.from('reports').select(TRAIL_REPORT_COLUMNS).eq('id', reportId).maybeSingle()
  if (error) return { response: dbError(c, error) }
  if (!data) return notFound()
  const report = data as unknown as TrailReportRow & { project_id: string }
  if (!(await canAccessReportProject(c, db, userId, report.project_id))) return notFound()
  return { report }
}

async function loadQueue(db: Db, reportId: string): Promise<{ rows: TrailQueueRow[] } | { error: { message: string } }> {
  const { data, error } = await db.from('processing_queue').select(TRAIL_QUEUE_COLUMNS).eq('report_id', reportId).order('created_at', { ascending: true }).limit(20)
  if (error) return { error }
  return { rows: (data ?? []) as unknown as TrailQueueRow[] }
}

export function registerReportPipelineRoutes(app: Hono<{ Variables: Variables }>, deps: ReportPipelineDeps = defaultDeps): void {
  app.get('/v1/admin/reports/:id/pipeline', jwtAuth, async (c: Ctx) => {
    const idParsed = parseUuidParam(c)
    if (!idParsed.ok) return idParsed.error
    const db = getServiceClient()
    const loaded = await loadReport(c, db, idParsed.value)
    if ('response' in loaded) return loaded.response
    const { report } = loaded

    const queue = await loadQueue(db, report.id)
    if ('error' in queue) return dbError(c, queue.error)

    const { data: fixData, error: fixErr } = await db
      .from('fix_attempts')
      .select(TRAIL_FIX_COLUMNS)
      .eq('report_id', report.id)
      .eq('project_id', report.project_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (fixErr) return dbError(c, fixErr)
    const fix = (fixData ?? null) as unknown as TrailFixRow | null

    // Deploys only matter once merged; a failed read leaves the Live stage unknown, never the page broken.
    let deploys: TrailDeployRow[] = []
    if (fix?.merged_at) {
      const since = new Date(Math.min(Date.parse(fix.merged_at), deps.now().getTime() - 14 * 86_400_000)).toISOString()
      const { data: d, error: dErr } = await db
        .from('deploy_observations')
        .select('observed_at, observed_version, ok')
        .eq('project_id', report.project_id)
        .gte('observed_at', since)
        .order('observed_at', { ascending: true })
        .limit(200)
      if (!dErr) deploys = (d ?? []) as TrailDeployRow[]
    }

    const trail = buildReportTrail({ report, queue: queue.rows, fix, deploys, now: deps.now() })
    return c.json({ ok: true, data: { reportId: report.id, fixId: fix?.id ?? null, generatedAt: deps.now().toISOString(), ...trail } })
  })

  app.post('/v1/admin/reports/:id/pipeline/retry', jwtAuth, async (c: Ctx) => {
    const idParsed = parseUuidParam(c)
    if (!idParsed.ok) return idParsed.error
    const body = (await c.req.json().catch(() => ({}))) as { stage?: unknown }
    const stage = typeof body.stage === 'string' ? body.stage : ''
    if (!TRIAGE_STAGES.has(stage)) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'stage must be "triage" or "diagnosis". A fix is retried with POST /v1/admin/fixes/dispatch, red CI with the pipeline action ci_repair.',
          },
        },
        400,
      )
    }

    const userId = c.get('userId') as string
    const db = getServiceClient()
    const loaded = await loadReport(c, db, idParsed.value)
    if ('response' in loaded) return loaded.response
    const { report } = loaded

    const access = await userCanAccessProject(db, userId, report.project_id)
    if (!access.allowed) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404)
    const viewerDenied = denyViewerWrite(c, access.role, 're-run triage')
    if (viewerDenied) return viewerDenied

    const queue = await loadQueue(db, report.id)
    if ('error' in queue) return dbError(c, queue.error)

    const now = deps.now()
    const decision = triageRetryDecision(report, queue.rows, now.getTime())
    if (decision.kind === 'deny') {
      return c.json({ ok: false, error: { code: 'NOT_RETRYABLE', message: decision.reason } }, 409)
    }
    if (decision.kind === 'already') {
      return c.json({ ok: true, data: { outcome: 'already', message: decision.reason } })
    }

    const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: userId,
      p_scope: TRIAGE_RETRY_RATE_SCOPE,
      p_max_per_window: TRIAGE_RETRY_PER_HOUR,
      p_window: '1 hour',
    })
    if (rateErr) {
      const limited = (rateErr.message ?? '').includes('rate_limit_exceeded')
      return c.json(
        {
          ok: false,
          error: limited
            ? { code: 'RATE_LIMITED', message: `At most ${TRIAGE_RETRY_PER_HOUR} triage retries an hour. Try again later.` }
            : { code: 'RATE_LIMIT_UNAVAILABLE', message: 'The retry did not start. Try again in a moment.' },
        },
        limited ? 429 : 503,
      )
    }

    const result = await applyTriageRetry(db, { report, projectId: report.project_id, job: decision.job }, deps.trigger, now)
    if (result.outcome === 'error') {
      return c.json({ ok: false, error: { code: 'RETRY_FAILED', message: result.message } }, 500)
    }
    if (result.outcome === 'queued') {
      await logAudit(db, report.project_id, userId, 'settings.updated', 'queue', report.id, { kind: 'retry_triage', stage }).catch(() => {})
    }
    return c.json({ ok: true, data: { outcome: result.outcome, message: result.message } })
  })
}
