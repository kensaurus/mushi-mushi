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
import { ownedProjectIds, resolveOwnedProject } from '../shared.ts'
import type { Variables } from '../types.ts'

function db() { return getServiceClient() }

export function registerAnomaliesRoutes(parent: Hono) {
  // GET /v1/admin/anomalies/stats — posture banner + ANOMALIES SNAPSHOT.
  parent.get('/v1/admin/anomalies/stats', requireAuth, async (c) => {
    const userId = c.get('userId') as string

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      openAnomalies: 0,
      confirmedAnomalies: 0,
      dismissedAnomalies: 0,
      autoReported: 0,
      releaseRegressionOpen: 0,
      highScoreOpen: 0,
      metricPointCount: 0,
      distinctMetrics: 0,
      lastDetectionAt: null as string | null,
      lastMetricAt: null as string | null,
      topPriority: 'no_project' as
        | 'no_project'
        | 'open_critical'
        | 'open_anomalies'
        | 'no_metrics'
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
    const activeProject = resolvedProject.project
    const pid = activeProject.id

    const [anomaliesRes, metricsRes, metricNamesRes] = await Promise.all([
      db()
        .from('anomaly_detections')
        .select('id, status, method, score, threshold, confirmed, auto_report_id, detected_at')
        .eq('project_id', pid)
        .order('detected_at', { ascending: false }),
      db()
        .from('metric_series')
        .select('id, ts', { count: 'exact', head: true })
        .eq('project_id', pid),
      db()
        .from('metric_series')
        .select('metric_name')
        .eq('project_id', pid)
        .order('ts', { ascending: false })
        .limit(500),
    ])

    const anomalies = anomaliesRes.data ?? []
    const metricPointCount = metricsRes.count ?? 0
    const distinctMetrics = new Set((metricNamesRes.data ?? []).map((m) => m.metric_name)).size

    const openRows = anomalies.filter((a) => a.status === 'open')
    const openAnomalies = openRows.length
    const confirmedAnomalies = anomalies.filter((a) => a.confirmed || a.status === 'confirmed').length
    const dismissedAnomalies = anomalies.filter((a) => a.status === 'dismissed').length
    const autoReported = anomalies.filter((a) => a.auto_report_id != null).length
    const releaseRegressionOpen = openRows.filter((a) => a.method === 'release-regression').length
    const highScoreOpen = openRows.filter((a) => (a.score ?? 0) >= (a.threshold ?? 3)).length

    const lastMetricRes = await db()
      .from('metric_series')
      .select('ts')
      .eq('project_id', pid)
      .order('ts', { ascending: false })
      .limit(1)
      .maybeSingle()

    let topPriority = empty.topPriority
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (metricPointCount === 0) {
      topPriority = 'no_metrics'
      topPriorityLabel = 'Ingest metric data points (error rate, latency, conversion) before running Page-Hinkley or Z-score detection.'
      topPriorityTo = '/anomalies?tab=metrics'
    } else if (releaseRegressionOpen > 0 || highScoreOpen > 0) {
      topPriority = 'open_critical'
      topPriorityLabel = `${openAnomalies} open finding${openAnomalies === 1 ? '' : 's'}${releaseRegressionOpen > 0 ? ` · ${releaseRegressionOpen} release regression` : ''} — confirm or dismiss to close the loop.`
      topPriorityTo = '/anomalies?tab=anomalies'
    } else if (openAnomalies > 0) {
      topPriority = 'open_anomalies'
      topPriorityLabel = `${openAnomalies} statistical anomal${openAnomalies === 1 ? 'y' : 'ies'} detected — review scores against baseline.`
      topPriorityTo = '/anomalies?tab=anomalies'
    } else {
      topPriority = 'healthy'
      topPriorityLabel = `${distinctMetrics} metric${distinctMetrics === 1 ? '' : 's'} · ${metricPointCount} point${metricPointCount === 1 ? '' : 's'} · 0 open anomalies.`
      topPriorityTo = '/anomalies?tab=detect'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.project_name ?? null,
        projectCount: projectIds.length,
        openAnomalies,
        confirmedAnomalies,
        dismissedAnomalies,
        autoReported,
        releaseRegressionOpen,
        highScoreOpen,
        metricPointCount,
        distinctMetrics,
        lastDetectionAt: anomalies[0]?.detected_at ?? null,
        lastMetricAt: lastMetricRes.data?.ts ?? null,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

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
