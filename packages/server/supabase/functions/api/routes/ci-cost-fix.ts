/**
 * ci-cost-fix.ts — the CI cost "Open fix PR" (ADR 0047). Served by `api-ext`
 * (`/v1/admin/ci/*` is forwarded there).
 *
 *   POST /v1/admin/ci/cost-fixes         adminOrApiKey(mcp:write), non-viewers, 10/h per project
 *        { projectId, repo, workflowPath, kind, evidence?, monthSavingUsd? }
 *        Checks the repo is one of the project's, queues a ci_cost_fix_jobs
 *        row and fires ci-cost-fix-worker, which opens a DRAFT PR applying
 *        one workflow edit (add_concurrency, skip_drafts, weekly_cron,
 *        ignore_docs_paths). 202 { job }. 409 COST_FIX_IN_PROGRESS when the
 *        same edit is already queued or running, or PR_ALREADY_OPEN (with
 *        the job) while its PR is still open.
 *   GET  /v1/admin/ci/cost-fixes/:id     adminOrApiKey(mcp:read)
 *        The job. For an opened PR: notices the merge on GitHub and stores
 *        the workflow's billed minutes per day since (up to 14 days) beside
 *        the 14 days before, so `saving` is measured, not projected. A job
 *        still queued after 2 minutes is fired again (its bundle, when it is
 *        part of one: ci-cost-fix-bundle.ts), and so is a bundle row left
 *        `running` past the 10-minute stale window.
 *   GET  /v1/admin/ci/cost-fixes?project_id=   adminOrApiKey(mcp:read)
 *        The project's last 50 jobs, newest first (stored values only).
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { logAudit } from '../../_shared/audit.ts'
import { runInBackground } from '../../_shared/background.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { CI_COST_FIX_KINDS } from '../../_shared/ci-cost-fix.ts'
import {
  COST_FIX_JOB_COLUMNS,
  COST_FIX_STALE_MS,
  findProjectRepo,
  refreshCostFixMeasurement,
  toCostFixView,
  type CostFixJobRow,
} from '../../_shared/ci-cost-fix-runner.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import type { Variables } from '../types.ts'

const clog = log.child('ci-cost-fix-routes')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const COST_FIXES_PER_HOUR = 10
/** A job still queued this long after it was created is fired again on read. */
export const REFIRE_AFTER_MS = 2 * 60_000

export const costFixRequestSchema = z.object({
  projectId: z.string().regex(UUID_RE, 'projectId must be a uuid'),
  repo: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'repo must be owner/name'),
  workflowPath: z
    .string()
    .max(200)
    .regex(/^\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/, 'workflowPath must be a file under .github/workflows/')
    .refine((p) => !p.includes('..'), 'workflowPath must not contain ..'),
  kind: z.enum(CI_COST_FIX_KINDS),
  evidence: z.string().max(2000).optional(),
  monthSavingUsd: z.number().finite().min(0).max(1_000_000).optional(),
})

type Db = ReturnType<typeof getServiceClient>

export interface CiCostFixRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  claimRateLimit: typeof claimTenantRateLimit
  callerCanAccessProject: typeof callerCanAccessProject
  findProjectRepo: typeof findProjectRepo
  refresh: (db: Db, job: CostFixJobRow) => Promise<CostFixJobRow>
  /** Fire-and-forget call to ci-cost-fix-worker for one job. */
  invokeWorker: (jobId: string) => void
  /** The same for a bundle (several fixes, one PR). */
  invokeBundleWorker: (bundleId: string) => void
  logAudit: typeof logAudit
  now: () => Date
}

/** Fire-and-forget POST to ci-cost-fix-worker with `{ jobId }` or `{ bundleId }`. */
export function invokeCostFixWorker(payload: { jobId: string } | { bundleId: string }): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const internalSecret = Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !internalSecret) return
  // A lost call is fired again by the next GET of the job.
  runInBackground(
    fetch(`${supabaseUrl}/functions/v1/ci-cost-fix-worker`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'ci-cost-fix-worker',
  )
}

export const defaultCiCostFixRouteDeps: CiCostFixRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  claimRateLimit: claimTenantRateLimit,
  callerCanAccessProject,
  findProjectRepo,
  refresh: (db, job) => refreshCostFixMeasurement(db as never, job),
  invokeWorker: (jobId) => invokeCostFixWorker({ jobId }),
  invokeBundleWorker: (bundleId) => invokeCostFixWorker({ bundleId }),
  logAudit,
  now: () => new Date(),
}

export function registerCiCostFixRoutes(app: Hono<{ Variables: Variables }>, deps: CiCostFixRouteDeps = defaultCiCostFixRouteDeps): void {
  app.post('/v1/admin/ci/cost-fixes', deps.adminOrApiKeyWrite, (c) => openCostFix(c, deps))
  app.get('/v1/admin/ci/cost-fixes', deps.adminOrApiKeyRead, (c) => listCostFixes(c, deps))
  app.get('/v1/admin/ci/cost-fixes/:id', deps.adminOrApiKeyRead, (c) => getCostFix(c, deps))
}

async function openCostFix(c: Context, deps: CiCostFixRouteDeps): Promise<Response> {
  const raw = await c.req.json().catch(() => null)
  const parsed = costFixRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; ').slice(0, 300), 400)
  }
  const body = parsed.data
  const userId = c.get('userId') as string
  const db = deps.getServiceClient()
  const access = await deps.callerCanAccessProject(c, db, userId, body.projectId)
  if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Project not found', 404)
  const viewer = denyViewerWrite(c, access.role, 'open a CI fix pull request')
  if (viewer) return viewer

  const repo = await deps.findProjectRepo(db as never, body.projectId, body.repo)
  if (!repo) return jsonError(c, 'REPO_NOT_IN_PROJECT', `${body.repo} is not connected to this project.`, 404)
  const repoName = `${repo.ref.owner}/${repo.ref.repo}`

  // A PR for the same edit that is still open: show it instead of a second one.
  const { data: open } = await db
    .from('ci_cost_fix_jobs')
    .select(COST_FIX_JOB_COLUMNS)
    .eq('project_id', body.projectId)
    .eq('repo', repoName)
    .eq('workflow_path', body.workflowPath)
    .eq('kind', body.kind)
    .eq('status', 'pr_opened')
    .is('merged_at', null)
    .is('closed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  const openJob = ((open ?? []) as CostFixJobRow[])[0]
  if (openJob) {
    return c.json(
      { ok: false, error: { code: 'PR_ALREADY_OPEN', message: `Mushi already opened this fix: ${openJob.pr_url ?? 'see the job'}. Review and merge that pull request.` }, data: { job: toCostFixView(openJob) } },
      409,
    )
  }

  const rate = await deps.claimRateLimit(db as never, `project:${body.projectId}:ci_cost_fix`, COST_FIXES_PER_HOUR, 3600)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 3600))
    return jsonError(c, 'RATE_LIMITED', `Mushi opens at most ${COST_FIXES_PER_HOUR} CI fix pull requests an hour per project.`, 429)
  }

  const { data: inserted, error } = await db
    .from('ci_cost_fix_jobs')
    .insert({
      project_id: body.projectId,
      requested_by: c.get('authMethod') === 'apiKey' ? null : userId,
      repo: repoName,
      workflow_path: body.workflowPath,
      kind: body.kind,
      status: 'queued',
      evidence: body.evidence ?? null,
      month_saving_usd: body.monthSavingUsd == null ? null : Math.round(body.monthSavingUsd * 100) / 100,
    })
    .select(COST_FIX_JOB_COLUMNS)
    .single()
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return jsonError(c, 'COST_FIX_IN_PROGRESS', 'Mushi is already opening this fix. Wait a moment and refresh.', 409)
    }
    if (/ci_cost_fix_jobs/.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
      return jsonError(c, 'MIGRATION_PENDING', 'CI fix pull requests are not set up on this server yet.', 409)
    }
    clog.error('ci_cost_fix_jobs insert failed', { projectId: body.projectId, err: error.message })
    return jsonError(c, 'DB_ERROR', 'Could not queue the fix.', 500)
  }
  const job = inserted as CostFixJobRow
  deps.invokeWorker(job.id)
  void deps
    .logAudit(db as never, body.projectId, userId, 'settings.updated', 'ci_cost_fix', job.id, {
      repo: repoName,
      workflowPath: body.workflowPath,
      kind: body.kind,
    }, { actorType: c.get('authMethod') === 'apiKey' ? 'api_key' : 'user' })
    .catch(() => null)
  return c.json({ ok: true, data: { job: toCostFixView(job) } }, 202)
}

async function getCostFix(c: Context, deps: CiCostFixRouteDeps): Promise<Response> {
  const id = c.req.param('id') ?? ''
  if (!UUID_RE.test(id)) return jsonError(c, 'VALIDATION_ERROR', 'id must be a uuid', 400)
  const db = deps.getServiceClient()
  const { data, error } = await db.from('ci_cost_fix_jobs').select(COST_FIX_JOB_COLUMNS).eq('id', id).maybeSingle()
  if (error) return jsonError(c, 'DB_ERROR', 'Could not read the fix.', 500)
  let job = data as CostFixJobRow | null
  if (!job) return jsonError(c, 'NOT_FOUND', 'Fix not found', 404)
  const access = await deps.callerCanAccessProject(c, db, c.get('userId') as string, job.project_id)
  if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Fix not found', 404)

  const nowMs = deps.now().getTime()
  // A bundle row stuck `running` past the stale window is fired again as its bundle (the worker reclaims it).
  const staleBundleRow = job.bundle_id && job.status === 'running' && job.started_at != null && nowMs - Date.parse(job.started_at) > COST_FIX_STALE_MS
  if ((job.status === 'queued' && nowMs - Date.parse(job.created_at) > REFIRE_AFTER_MS) || staleBundleRow) {
    if (job.bundle_id) deps.invokeBundleWorker(job.bundle_id)
    else deps.invokeWorker(job.id)
  } else if (job.status === 'pr_opened') {
    job = await deps.refresh(db, job)
  }
  return c.json({ ok: true, data: { job: toCostFixView(job) } })
}

async function listCostFixes(c: Context, deps: CiCostFixRouteDeps): Promise<Response> {
  const projectId = c.req.query('project_id') ?? (c.get('projectId') as string | undefined) ?? ''
  if (!UUID_RE.test(projectId)) return jsonError(c, 'VALIDATION_ERROR', 'project_id must be a uuid', 400)
  const db = deps.getServiceClient()
  const access = await deps.callerCanAccessProject(c, db, c.get('userId') as string, projectId)
  if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Project not found', 404)
  const { data, error } = await db
    .from('ci_cost_fix_jobs')
    .select(COST_FIX_JOB_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return c.json({ ok: true, data: { jobs: [] } })
    return jsonError(c, 'DB_ERROR', 'Could not read the fixes.', 500)
  }
  return c.json({ ok: true, data: { jobs: ((data ?? []) as CostFixJobRow[]).map(toCostFixView) } })
}
