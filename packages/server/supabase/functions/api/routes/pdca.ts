// pdca.ts — PDCA run admin endpoints
//
// Admin (JWT, org-scoped):
//   GET  /v1/admin/pdca/stats              — aggregate counts for KPI strip
//   GET  /v1/admin/pdca                    — list PDCA runs for a project
//   POST /v1/admin/pdca                    — queue a new PDCA run
//   GET  /v1/admin/pdca/:id               — run detail + all iterations
//   DELETE /v1/admin/pdca/:id             — abort a queued/running run
//   POST /v1/admin/pdca/:id/trigger       — manually trigger the runner for a queued run
//
// Phase 3b — Mushi closed-loop evolution

import { Hono } from 'npm:hono@4'
import type { Context } from 'npm:hono@4'
import { requireAuth } from '../middleware/auth.ts'
import { requireProjectAccess } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { accessibleProjectIds } from '../../_shared/project-access.ts'
import { ownedProjectIds, resolveOwnedProject } from '../shared.ts'
import type { Variables } from '../types.ts'

const app = new Hono<{ Variables: Variables }>()

function db() {
  return getServiceClient()
}

function projectIdFromRequest(c: Context<{ Variables: Variables }>): string | null {
  return (
    c.req.query('project_id') ??
    c.req.header('x-mushi-project-id') ??
    c.req.header('X-Mushi-Project-Id') ??
    null
  )
}

async function assertRunAccess(
  c: Context<{ Variables: Variables }>,
  runId: string,
): Promise<{ ok: true; projectId: string } | { ok: false; response: Response }> {
  const userId = c.get('userId')
  const { data: run, error } = await db()
    .from('pdca_runs')
    .select('id, project_id')
    .eq('id', runId)
    .maybeSingle()

  if (error || !run) {
    return {
      ok: false,
      response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Run not found' } }, 404),
    }
  }

  const allowed = await accessibleProjectIds(db(), userId)
  if (!allowed.includes(run.project_id as string)) {
    return {
      ok: false,
      response: c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } }, 403),
    }
  }

  return { ok: true, projectId: run.project_id as string }
}

export function registerPdcaRoutes(parent: Hono<any>) {
  parent.route('/v1/admin/pdca', pdcaRoutes())
}

function pdcaRoutes() {
  const r = new Hono<{ Variables: Variables }>()
  r.use('*', requireAuth, requireProjectAccess)

  // Stats for KPI strip + posture banner — must be registered before /:id
  r.get('/stats', async (c) => {
    const userId = c.get('userId') as string

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      total: 0,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      aborted: 0,
      avgFinalScore: null as number | null,
      avgFinalScorePct: null as number | null,
      totalIterations: 0,
      runsMeetingTarget: 0,
      lastRunAt: null as string | null,
      daysSinceLastRun: null as number | null,
      lastFailedUrl: null as string | null,
      lastFailedAt: null as string | null,
      topPriority: 'no_project' as
        | 'no_project'
        | 'active_runs'
        | 'queued_waiting'
        | 'last_failed'
        | 'no_runs'
        | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    const projectIds = await ownedProjectIds(db(), userId)
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: empty })
    }

    const resolvedProject = await resolveOwnedProject(c, db(), userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: { ...empty, hasAnyProject: true, projectCount: projectIds.length },
        }),
    })
    if ('response' in resolvedProject) return resolvedProject.response
    const projectId = resolvedProject.project.id
    const projectName = resolvedProject.project.project_name ?? null

    const { data: runs, error } = await db()
      .from('pdca_runs')
      .select('id, status, final_score, target_score, target_url, created_at, finished_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }

    const rows = runs ?? []
    const runIds = rows.map((r) => r.id as string)
    const iterationsRes =
      runIds.length > 0
        ? await db()
            .from('pdca_iterations')
            .select('id', { count: 'exact', head: true })
            .in('run_id', runIds)
        : { count: 0 }

    const queued = rows.filter((r) => r.status === 'queued').length
    const running = rows.filter((r) => r.status === 'running').length
    const succeeded = rows.filter((r) => r.status === 'succeeded').length
    const failed = rows.filter((r) => r.status === 'failed').length
    const aborted = rows.filter((r) => r.status === 'aborted').length
    const scored = rows.filter((r) => r.final_score != null)
    const avgFinalScore =
      scored.length > 0
        ? scored.reduce((sum, r) => sum + (r.final_score as number), 0) / scored.length
        : null
    const avgFinalScorePct = avgFinalScore != null ? Math.round(avgFinalScore * 1000) / 10 : null
    const runsMeetingTarget = rows.filter(
      (r) =>
        r.final_score != null &&
        r.target_score != null &&
        (r.final_score as number) >= (r.target_score as number),
    ).length
    const lastRunAt = (rows[0]?.created_at as string | null) ?? null
    const daysSinceLastRun = lastRunAt
      ? Math.floor((Date.now() - new Date(lastRunAt).getTime()) / (24 * 60 * 60 * 1000))
      : null
    const lastFailed = rows.find((r) => r.status === 'failed') ?? null

    let topPriority = empty.topPriority
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (running > 0) {
      topPriority = 'active_runs'
      topPriorityLabel = `${running} run${running === 1 ? '' : 's'} executing producer → critic loop — page auto-refreshes every 4s.`
      topPriorityTo = '/iterate?tab=runs'
    } else if (queued > 0) {
      topPriority = 'queued_waiting'
      topPriorityLabel = `${queued} run${queued === 1 ? '' : 's'} queued — click Trigger on each row to start the pdca-runner (or wait for cron).`
      topPriorityTo = '/iterate?tab=runs'
    } else if (lastFailed) {
      topPriority = 'last_failed'
      topPriorityLabel = `Latest failure on ${lastFailed.target_url as string} — open the run to inspect iterations, then queue a new run.`
      topPriorityTo = '/iterate?tab=runs'
    } else if (rows.length === 0) {
      topPriority = 'no_runs'
      topPriorityLabel = 'No PDCA runs yet — queue a target URL with a critic persona on the New Run tab.'
      topPriorityTo = '/iterate?tab=new'
    } else {
      topPriority = 'healthy'
      topPriorityLabel = `${succeeded} succeeded · ${runsMeetingTarget} met target · avg score ${avgFinalScorePct ?? 0}%.`
      topPriorityTo = '/iterate?tab=runs'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId,
        projectName,
        projectCount: projectIds.length,
        total: rows.length,
        queued,
        running,
        succeeded,
        failed,
        aborted,
        avgFinalScore,
        avgFinalScorePct,
        totalIterations: iterationsRes.count ?? 0,
        runsMeetingTarget,
        lastRunAt,
        daysSinceLastRun,
        lastFailedUrl: (lastFailed?.target_url as string | null) ?? null,
        lastFailedAt: (lastFailed?.finished_at as string | null) ?? (lastFailed?.created_at as string | null) ?? null,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  // List runs for a project
  r.get('/', async (c) => {
    const projectId = projectIdFromRequest(c)
    if (!projectId) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'project_id required' } },
        400,
      )
    }

    const status = c.req.query('status')
    const page = parseInt(c.req.query('page') ?? '1', 10)
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)

    let q = db()
      .from('pdca_runs')
      .select('*', { count: 'exact' })
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (status) q = q.eq('status', status)

    const { data, error, count } = await q
    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }
    return c.json({ ok: true, data: data ?? [], total: count, page, limit })
  })

  // Queue a new run
  r.post('/', async (c) => {
    const body = await c.req.json()
    const projectId =
      (typeof body.project_id === 'string' ? body.project_id : null) ?? projectIdFromRequest(c)
    const { target_url, goal, iterations_target, primary_model, judge_model, persona, target_score } =
      body

    if (!projectId || !target_url || !goal) {
      return c.json(
        {
          ok: false,
          error: { code: 'BAD_REQUEST', message: 'project_id, target_url and goal are required' },
        },
        400,
      )
    }

    const { data, error } = await db()
      .from('pdca_runs')
      .insert({
        project_id: projectId,
        target_url,
        goal,
        iterations_target: iterations_target ?? 5,
        primary_model: primary_model ?? 'claude-sonnet-4-6',
        judge_model: judge_model ?? 'claude-sonnet-4-6',
        persona: persona ?? 'nng-heuristic',
        target_score: target_score ?? 0.7,
      })
      .select()
      .single()

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }
    return c.json({ ok: true, data }, 201)
  })

  // Run detail + iterations
  r.get('/:id', async (c) => {
    const runId = c.req.param('id')
    const access = await assertRunAccess(c, runId)
    if (!access.ok) return access.response

    const { data: run, error } = await db().from('pdca_runs').select('*').eq('id', runId).single()
    if (error) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404)
    }

    const { data: iterations } = await db()
      .from('pdca_iterations')
      .select('*')
      .eq('run_id', runId)
      .order('iteration_n', { ascending: true })

    return c.json({ ok: true, data: { ...run, iterations: iterations ?? [] } })
  })

  // Abort a run
  r.delete('/:id', async (c) => {
    const runId = c.req.param('id')
    const access = await assertRunAccess(c, runId)
    if (!access.ok) return access.response

    const { error } = await db()
      .from('pdca_runs')
      .update({ status: 'aborted', finished_at: new Date().toISOString() })
      .eq('id', runId)
      .in('status', ['queued', 'running'])
    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }
    return c.json({ ok: true })
  })

  // Manually trigger the runner for a queued run (invokes pdca-runner edge function)
  r.post('/:id/trigger', async (c) => {
    const runId = c.req.param('id')
    const access = await assertRunAccess(c, runId)
    if (!access.ok) return access.response

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/pdca-runner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ run_id: runId }),
      })
      const json = await res.json()
      if (!res.ok) return c.json({ ok: false, error: json }, res.status)
      return c.json({ ok: true, ...json })
    } catch (err) {
      return c.json({ ok: false, error: { code: 'ERROR', message: String(err) } }, 500)
    }
  })

  return r
}

export { pdcaRoutes }
