// drift.ts — Contract drift admin endpoints
//
// Admin (JWT, org-scoped):
//   GET  /v1/admin/drift                      — list drift findings for a project
//   POST /v1/admin/drift/scan                 — trigger drift-walker for a project
//   GET  /v1/admin/drift/snapshots            — list contract snapshots
//   GET  /v1/admin/drift/snapshots/:id        — snapshot detail (openapi, inventory, pg_schema)
//   PATCH /v1/admin/drift/:id                 — dismiss/reopen a finding
//   POST /v1/admin/drift/:id/create-lesson    — promote finding to candidate lesson
//
// Phase 4d — Mushi closed-loop evolution

import { Hono } from 'npm:hono@4'
import { requireAuth } from '../middleware/auth.ts'
import { requireProjectAccess } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
import type { Variables } from '../types.ts'

function db() { return getServiceClient() }

export function registerDriftRoutes(parent: Hono<{ Variables: Variables }>) {
  const r = new Hono<{ Variables: Variables }>()
  r.use('*', requireAuth, requireProjectAccess)

  // List findings
  r.get('/', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)
    const status = c.req.query('status') ?? 'open'
    const severity = c.req.query('severity')
    const surface = c.req.query('surface')
    const page = parseInt(c.req.query('page') ?? '1', 10)
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200)

    let q = db()
      .from('drift_findings')
      .select('*', { count: 'exact' })
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (status) q = q.eq('status', status)
    if (severity) q = q.eq('severity', severity)
    if (surface) q = q.eq('surface', surface)

    const { data, error, count } = await q
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data, total: count, page, limit })
  })

  // Trigger a drift scan
  r.post('/scan', async (c) => {
    const body = await c.req.json()
    const { project_id, max_paths } = body
    if (!project_id) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const res = await fetch(`${supabaseUrl}/functions/v1/drift-walker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ project_id, max_paths }),
    })
    const json = await res.json()
    if (!res.ok) {
      // Forward the structured error from drift-walker (BUILDER_FAILED,
      // BUILDER_UNREACHABLE, NO_SNAPSHOT, etc.) so the admin UI's
      // SCAN_ERROR_TIPS lookup can provide actionable guidance.
      const code: string = (json?.error?.code as string | undefined) ?? 'UPSTREAM_ERROR'
      const message: string = (json?.error?.message as string | undefined) ?? JSON.stringify(json)
      return c.json({ ok: false, error: { code, message } }, res.status as 500)
    }
    return c.json({ ok: true, ...json })
  })

  // List snapshots
  r.get('/snapshots', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)
    const { data, error } = await db()
      .from('contract_snapshots')
      .select('id, project_id, snapshot_at, edge_count, created_at')
      .eq('project_id', projectId)
      .order('snapshot_at', { ascending: false })
      .limit(20)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data })
  })

  // Snapshot detail
  r.get('/snapshots/:id', async (c) => {
    const { data, error } = await db()
      .from('contract_snapshots')
      .select('*')
      .eq('id', c.req.param('id'))
      .single()
    if (error) return c.json({ ok: false, error: { code: 'ERROR', message: 'Not found' } }, 404)
    return c.json({ ok: true, data })
  })

  // Dismiss / reopen a finding
  r.patch('/:id', async (c) => {
    const body = await c.req.json()
    const { status } = body
    if (!['open', 'dismissed'].includes(status)) return c.json({ ok: false, error: { code: 'ERROR', message: 'invalid status' } }, 400)
    const update: Record<string, unknown> = { status }
    if (status === 'dismissed') update.dismissed_at = new Date().toISOString()
    const { error } = await db()
      .from('drift_findings')
      .update(update)
      .eq('id', c.req.param('id'))
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true })
  })

  // Promote finding to candidate lesson
  r.post('/:id/create-lesson', async (c) => {
    const { data: finding } = await db()
      .from('drift_findings')
      .select('*')
      .eq('id', c.req.param('id'))
      .single()
    if (!finding) return c.json({ ok: false, error: { code: 'ERROR', message: 'Not found' } }, 404)
    const { data: lesson, error } = await db()
      .from('mistake_clusters')
      .insert({
        project_id: finding.project_id,
        status: 'candidate',
        name: `[Drift] ${finding.finding_type}`,
        summary: finding.message,
        suggested_rule: `Fix: ${finding.message}`,
        cluster_size: 1,
        severity_distribution: { [finding.severity]: 1 },
      })
      .select()
      .single()
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, lesson_id: lesson.id })
  })

  parent.route('/v1/admin/drift', r)
}
