// pdca.ts — PDCA run admin endpoints
//
// Admin (JWT, org-scoped):
//   GET  /v1/admin/pdca                    — list PDCA runs for a project
//   POST /v1/admin/pdca                    — queue a new PDCA run
//   GET  /v1/admin/pdca/:id               — run detail + all iterations
//   DELETE /v1/admin/pdca/:id             — abort a queued/running run
//   POST /v1/admin/pdca/:id/trigger       — manually trigger the runner for a queued run
//
// Phase 3b — Mushi closed-loop evolution

import { Hono } from 'npm:hono@4'
import { requireAuth } from '../middleware/auth.ts'
import { requireProjectAccess } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
import type { Variables } from '../types.ts'

const app = new Hono<{ Variables: Variables }>()

function db() { return getServiceClient() }

export function registerPdcaRoutes(parent: Hono<{ Variables: Variables }>) {
  parent.route('/v1/admin/pdca', pdcaRoutes())
}

function pdcaRoutes() {
  const r = new Hono<{ Variables: Variables }>()
  r.use('*', requireAuth, requireProjectAccess)

  // List runs for a project
  r.get('/', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)

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
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data, total: count, page, limit })
  })

  // Queue a new run
  r.post('/', async (c) => {
    const body = await c.req.json()
    const { project_id, target_url, goal, iterations_target, primary_model, judge_model, persona, target_score } = body

    if (!project_id || !target_url || !goal)
      return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id, target_url and goal are required' } }, 400)

    const { data, error } = await db()
      .from('pdca_runs')
      .insert({
        project_id,
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

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data }, 201)
  })

  // Run detail + iterations
  r.get('/:id', async (c) => {
    const runId = c.req.param('id')
    const { data: run, error } = await db()
      .from('pdca_runs')
      .select('*')
      .eq('id', runId)
      .single()
    if (error) return c.json({ ok: false, error: { code: 'ERROR', message: 'Not found' } }, 404)

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
    const { error } = await db()
      .from('pdca_runs')
      .update({ status: 'aborted', finished_at: new Date().toISOString() })
      .eq('id', runId)
      .in('status', ['queued', 'running'])
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true })
  })

  // Manually trigger the runner for a queued run (invokes pdca-runner edge function)
  r.post('/:id/trigger', async (c) => {
    const runId = c.req.param('id')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/pdca-runner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ run_id: runId }),
      })
      const json = await res.json()
      if (!res.ok) return c.json({ error: json }, res.status)
      return c.json({ ok: true, ...json })
    } catch (err) {
      return c.json({ ok: false, error: { code: 'ERROR', message: String(err) } }, 500)
    }
  })

  return r
}

// needed for tree-shake  (re-exported in api/index.ts)
export { pdcaRoutes }
