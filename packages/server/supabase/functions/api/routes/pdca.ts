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

export function registerPdcaRoutes(parent: Hono<{ Variables: Variables }>) {
  parent.route('/v1/admin/pdca', pdcaRoutes())
}

function pdcaRoutes() {
  const r = new Hono<{ Variables: Variables }>()
  r.use('*', requireAuth, requireProjectAccess)

  // Stats for KPI strip — must be registered before /:id
  r.get('/stats', async (c) => {
    const projectId = projectIdFromRequest(c)
    if (!projectId) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'project_id required' } },
        400,
      )
    }

    const { data: runs, error } = await db()
      .from('pdca_runs')
      .select('status, final_score, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }

    const rows = runs ?? []
    const scored = rows.filter((r) => r.final_score != null)
    const avgFinalScore =
      scored.length > 0
        ? scored.reduce((sum, r) => sum + (r.final_score as number), 0) / scored.length
        : null

    return c.json({
      ok: true,
      data: {
        total: rows.length,
        queued: rows.filter((r) => r.status === 'queued').length,
        running: rows.filter((r) => r.status === 'running').length,
        succeeded: rows.filter((r) => r.status === 'succeeded').length,
        failed: rows.filter((r) => r.status === 'failed').length,
        aborted: rows.filter((r) => r.status === 'aborted').length,
        avgFinalScore,
        lastRunAt: (rows[0]?.created_at as string | null) ?? null,
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
