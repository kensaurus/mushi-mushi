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

import { Hono, type Context } from 'npm:hono@4'
import { requireAuth } from '../middleware/auth.ts'
import { checkProjectAccessIfNamed } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
import {
  assertTargetProjectAccess,
  callerCanAccessProject,
  ownedProjectIds,
  resolveOwnedProject,
} from '../shared.ts'
import type { Variables } from '../types.ts'

// Access: these routers use checkProjectAccessIfNamed, which only checks a
// project the request names. Every handler that writes resolves its own
// project (the body's project_id, or the anomaly row's) and checks it.
// Until 2026-10 detect, ingest and confirm/dismiss trusted the caller.

function db() { return getServiceClient() }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ANOMALY_STATUSES = new Set(['open', 'confirmed', 'dismissed'])
const MAX_METRIC_POINTS = 1000

function namedProject(c: Context): string | null {
  return c.req.query('project_id') ?? c.req.header('x-mushi-project-id') ?? null
}

export function registerAnomaliesRoutes(parent: Hono<{ Variables: Variables }>) {
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
        projectName: activeProject.name ?? null,
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
  r.use('*', requireAuth, checkProjectAccessIfNamed)

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
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const { metric_name, lookback_hours } = body
    // The project comes from the body (the console sends it there) or the
    // named project, and the caller must be able to reach it: the detector
    // runs with the service role and can file reports in that project.
    const project_id = typeof body.project_id === 'string' ? body.project_id : namedProject(c)
    if (!project_id) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)
    const access = await assertTargetProjectAccess(c, db(), c.get('userId') as string, project_id)
    if (!access.ok) return access.response
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const res = await fetch(`${supabaseUrl}/functions/v1/anomaly-detector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ project_id, metric_name, lookback_hours }),
    })
    const json = await res.json()
    if (!res.ok) return c.json({ ok: false, error: { code: 'UPSTREAM_ERROR', message: JSON.stringify(json) } }, res.status as 200)
    return c.json({ ok: true, ...json })
  })

  // Confirm / dismiss
  r.patch('/:id', async (c) => {
    const id = c.req.param('id')!
    const notFound = () => c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404)
    if (!UUID_RE.test(id)) return notFound()
    // Resolve the anomaly's own project and check the caller can reach it.
    // A miss and a no-access answer the same 404, so ids can't be probed.
    const { data: row } = await db()
      .from('anomaly_detections')
      .select('id, project_id')
      .eq('id', id)
      .maybeSingle()
    const projectId = (row?.project_id as string | undefined) ?? null
    if (!projectId) return notFound()
    const access = await callerCanAccessProject(c, db(), c.get('userId') as string, projectId)
    if (!access.allowed) return notFound()

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const { status, confirmed } = body
    const update: Record<string, unknown> = {}
    if (status != null) {
      if (typeof status !== 'string' || !ANOMALY_STATUSES.has(status)) {
        return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'status must be open, confirmed or dismissed' } }, 400)
      }
      update.status = status
    }
    if (confirmed != null) {
      if (typeof confirmed !== 'boolean') {
        return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'confirmed must be true or false' } }, 400)
      }
      update.confirmed = confirmed
    }
    if (Object.keys(update).length === 0) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Nothing to update' } }, 400)
    }
    const { error } = await db()
      .from('anomaly_detections')
      .update(update)
      .eq('id', id)
      .eq('project_id', projectId)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true })
  })

  parent.route('/v1/admin/anomalies', r)

  // Metric series
  const ms = new Hono<{ Variables: Variables }>()
  ms.use('*', requireAuth, checkProjectAccessIfNamed)

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
    const body = await c.req.json().catch(() => null)
    const raw: unknown[] = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : []
    if (raw.length === 0) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Send one metric point or a list of them' } }, 400)
    }
    if (raw.length > MAX_METRIC_POINTS) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: `Send at most ${MAX_METRIC_POINTS} points at once` } }, 400)
    }

    // Every point lands in one project: the one the points name, else the
    // named project. A batch naming two projects is refused, and the caller
    // must be able to reach the project before anything is written.
    const named = namedProject(c)
    const bodyProjects = new Set(
      raw.map((p) => (p as Record<string, unknown>)?.project_id).filter((v): v is string => typeof v === 'string'),
    )
    if (bodyProjects.size > 1) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'All points must belong to one project' } }, 400)
    }
    const projectId = bodyProjects.values().next().value ?? named
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)
    const access = await assertTargetProjectAccess(c, db(), c.get('userId') as string, projectId)
    if (!access.ok) return access.response

    const points: Array<Record<string, unknown>> = []
    for (const item of raw) {
      const p = (item ?? {}) as Record<string, unknown>
      const value = typeof p.value === 'number' ? p.value : Number.NaN
      const ts = typeof p.ts === 'string' && !Number.isNaN(Date.parse(p.ts)) ? new Date(p.ts).toISOString() : null
      if (typeof p.metric_name !== 'string' || !p.metric_name.trim() || !Number.isFinite(value) || !ts) {
        return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Each point needs metric_name, a numeric value and a valid ts' } }, 400)
      }
      // Only these columns are writable; id, created_at and anything else
      // the body carries are ignored.
      points.push({
        project_id: projectId,
        metric_name: p.metric_name.trim().slice(0, 200),
        value,
        ts,
        dimension: typeof p.dimension === 'string' ? p.dimension.slice(0, 200) : null,
      })
    }

    const { error } = await db().from('metric_series').insert(points)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, inserted: points.length }, 201)
  })

  parent.route('/v1/admin/metric-series', ms)
}
