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
import { ownedProjectIds, resolveOwnedProject } from '../shared.ts'
import type { Variables } from '../types.ts'

function db() { return getServiceClient() }

export function registerDriftRoutes(parent: Hono<any>) {
  // GET /v1/admin/drift/stats — posture banner + DRIFT SNAPSHOT (before nested /:id routes).
  parent.get('/v1/admin/drift/stats', requireAuth, async (c) => {
    const userId = c.get('userId') as string

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      openFindings: 0,
      criticalOpen: 0,
      warnOpen: 0,
      infoOpen: 0,
      dismissedFindings: 0,
      snapshotCount: 0,
      lastSnapshotAt: null as string | null,
      lastSnapshotEdges: 0,
      edgeCountDelta: null as number | null,
      surfacesWithFindings: 0,
      lastFindingAt: null as string | null,
      topPriority: 'no_project' as
        | 'no_project'
        | 'critical_findings'
        | 'warn_findings'
        | 'never_scanned'
        | 'stale_scan'
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

    const [openRes, dismissedRes, snapshotsRes, snapshotCountRes, lastFindingRes, surfacesRes] = await Promise.all([
      db()
        .from('drift_findings')
        .select('severity, surface')
        .eq('project_id', pid)
        .eq('status', 'open'),
      db()
        .from('drift_findings')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .eq('status', 'dismissed'),
      // Fetch only the 2 most-recent snapshots for delta calculation.
      db()
        .from('contract_snapshots')
        .select('id, snapshot_at, edge_count')
        .eq('project_id', pid)
        .order('snapshot_at', { ascending: false })
        .limit(2),
      // Separate server-side count so `snapshotCount` reflects the true total,
      // not the limit-2 slice above.
      db()
        .from('contract_snapshots')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid),
      db()
        .from('drift_findings')
        .select('created_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db()
        .from('drift_findings')
        .select('surface')
        .eq('project_id', pid)
        .eq('status', 'open'),
    ])

    const openRows = openRes.data ?? []
    const criticalOpen = openRows.filter((r) => r.severity === 'critical').length
    const warnOpen = openRows.filter((r) => r.severity === 'warn').length
    const infoOpen = openRows.filter((r) => r.severity === 'info').length
    const openFindings = openRows.length

    const snapshots = snapshotsRes.data ?? []
    const snapshotCount = snapshotCountRes.count ?? snapshots.length
    const lastSnapshot = snapshots[0] ?? null
    const prevSnapshot = snapshots[1] ?? null
    const lastSnapshotAt = lastSnapshot?.snapshot_at ?? null
    const lastSnapshotEdges = lastSnapshot?.edge_count ?? 0
    const edgeCountDelta =
      lastSnapshot && prevSnapshot
        ? (lastSnapshot.edge_count ?? 0) - (prevSnapshot.edge_count ?? 0)
        : null

    const surfaceSet = new Set((surfacesRes.data ?? []).map((r) => r.surface).filter(Boolean))
    const dismissedFindings = dismissedRes.count ?? 0

    let topPriority = empty.topPriority
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    const STALE_MS = 7 * 24 * 60 * 60 * 1000
    const isStale =
      lastSnapshotAt != null && Date.now() - new Date(lastSnapshotAt).getTime() > STALE_MS

    if (criticalOpen > 0) {
      topPriority = 'critical_findings'
      topPriorityLabel = `${criticalOpen} critical gap${criticalOpen === 1 ? '' : 's'} between OpenAPI, inventory, and DB schema — triage before users hit them.`
      topPriorityTo = '/drift?tab=findings'
    } else if (warnOpen > 0) {
      topPriority = 'warn_findings'
      topPriorityLabel = `${warnOpen} warning-level drift finding${warnOpen === 1 ? '' : 's'} — review or dismiss false positives.`
      topPriorityTo = '/drift?tab=findings'
    } else if (snapshotCount === 0) {
      topPriority = 'never_scanned'
      topPriorityLabel = 'Run a drift scan to build the first contract snapshot and baseline your API edges.'
      topPriorityTo = '/drift?tab=scanner'
    } else if (isStale) {
      topPriority = 'stale_scan'
      topPriorityLabel = `Last snapshot ${Math.round((Date.now() - new Date(lastSnapshotAt!).getTime()) / (24 * 60 * 60 * 1000))}d ago — re-scan to catch new divergence.`
      topPriorityTo = '/drift?tab=scanner'
    } else {
      topPriority = 'healthy'
      topPriorityLabel = `${snapshotCount} snapshot${snapshotCount === 1 ? '' : 's'} · ${lastSnapshotEdges} contract edges · 0 open findings.`
      topPriorityTo = '/drift?tab=snapshots'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.project_name ?? null,
        projectCount: projectIds.length,
        openFindings,
        criticalOpen,
        warnOpen,
        infoOpen,
        dismissedFindings,
        snapshotCount,
        lastSnapshotAt,
        lastSnapshotEdges,
        edgeCountDelta,
        surfacesWithFindings: surfaceSet.size,
        lastFindingAt: lastFindingRes.data?.created_at ?? null,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

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
    if (!res.ok) return c.json({ ok: false, error: { code: 'UPSTREAM_ERROR', message: JSON.stringify(json) } }, res.status)
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
