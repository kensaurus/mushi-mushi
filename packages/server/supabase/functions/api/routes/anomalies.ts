// anomalies.ts — Metric series + anomaly detection admin endpoints
//
// Admin:
//   GET  /v1/admin/anomalies                  — list anomaly detections
//   POST /v1/admin/anomalies/detect           — trigger anomaly-detector
//   PATCH /v1/admin/anomalies/:id             — confirm / dismiss
//   GET  /v1/admin/metric-series              — list metric_series points
//   POST /v1/admin/metric-series              — ingest metric data point (or batch)
//
// Phase 6 — Mushi closed-loop evolution

import { Hono } from 'npm:hono@4'
import { requireAuth } from '../middleware/auth.ts'
import { requireProjectAccess } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
import type { Variables } from '../types.ts'

function db() { return getServiceClient() }

export function registerAnomaliesRoutes(parent: Hono<{ Variables: Variables }>) {
  const r = new Hono<{ Variables: Variables }>()
  r.use('*', requireAuth, requireProjectAccess)

  // List anomaly detections
  r.get('/', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)
    const status = c.req.query('status') ?? 'open'
    const page = parseInt(c.req.query('page') ?? '1', 10)
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200)

    let q = db()
      .from('anomaly_detections')
      .select('*', { count: 'exact' })
      .eq('project_id', projectId)
      .order('detected_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)
    if (status) q = q.eq('status', status)

    const { data, error, count } = await q
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data, total: count, page, limit })
  })

  // Trigger anomaly detection
  r.post('/detect', async (c) => {
    const body = await c.req.json()
    const { project_id, metric_name, lookback_hours } = body
    if (!project_id) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const res = await fetch(`${supabaseUrl}/functions/v1/anomaly-detector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ project_id, metric_name, lookback_hours }),
    })
    const json = await res.json()
    if (!res.ok) return c.json({ ok: false, error: { code: 'UPSTREAM_ERROR', message: JSON.stringify(json) } }, res.status)
    return c.json({ ok: true, ...json })
  })

  // Confirm / dismiss
  r.patch('/:id', async (c) => {
    const body = await c.req.json()
    const { status, confirmed } = body
    const update: Record<string, unknown> = {}
    if (status) update.status = status
    if (confirmed != null) update.confirmed = confirmed
    const { error } = await db().from('anomaly_detections').update(update).eq('id', c.req.param('id'))
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true })
  })

  parent.route('/v1/admin/anomalies', r)

  // Metric series
  const ms = new Hono<{ Variables: Variables }>()
  ms.use('*', requireAuth, requireProjectAccess)

  ms.get('/', async (c) => {
    const projectId = c.req.query('project_id')
    const metricName = c.req.query('metric_name')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)
    let q = db()
      .from('metric_series')
      .select('ts, value, metric_name, dimension')
      .eq('project_id', projectId)
      .order('ts', { ascending: false })
      .limit(500)
    if (metricName) q = q.eq('metric_name', metricName)
    const { data, error } = await q
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data })
  })

  ms.post('/', async (c) => {
    const body = await c.req.json()
    const points = Array.isArray(body) ? body : [body]
    const { error } = await db().from('metric_series').insert(points)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, inserted: points.length }, 201)
  })

  parent.route('/v1/admin/metric-series', ms)
}
