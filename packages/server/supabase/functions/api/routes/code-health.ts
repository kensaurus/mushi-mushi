/**
 * code-health.ts — Admin read endpoint for Code Health data.
 *
 * GET /v1/admin/code-health?project_id=<uuid>
 *   Returns bundle-size trends (from metric_series) and the latest
 *   code_health gate run's findings (god-file LOC violations).
 *
 * Auth: requireAuth + requireProjectAccess (JWT-gated, same as other admin routes).
 *
 * Response shape:
 *   {
 *     ok: true,
 *     data: CodeHealthResponse
 *   }
 */

import type { Hono } from 'npm:hono@4'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { resolveOwnedProject } from '../shared.ts'
import type { Variables } from '../types.ts'

const hlog = log.child('code-health')

// ── Public type (shared with admin frontend) ─────────────────────────────────

export interface TrendPoint {
  ts: string
  value: number
  dimension: string | null
}

export interface BundleTrends {
  /** mobile.gzip_kb series keyed by dimension (ios/android/combined) */
  mobile: Record<string, TrendPoint[]>
  /** web.gzip_kb series */
  web: TrendPoint[]
  /** code_health.god_file_count series keyed by dimension (mobile/web) */
  godFileCounts: Record<string, TrendPoint[]>
  /** code_health.max_file_loc series */
  maxFileLoc: Record<string, TrendPoint[]>
}

export interface GodFileFinding {
  id: string
  rule_id: string
  severity: 'error' | 'warn' | 'info'
  file_path: string | null
  line: number | null
  message: string
  suggested_fix: Record<string, unknown> | null
}

export interface CodeHealthResponse {
  trends: BundleTrends
  godFiles: GodFileFinding[]
  latestRunAt: string | null
  latestRunStatus: string | null
  summary: {
    error_count: number
    warn_count: number
    max_loc: number | null
    latest_bundle_kb: number | null
  }
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerCodeHealthRoutes(app: Hono<{ Variables: Variables }>): void {
  /**
   * GET /v1/admin/code-health
   *
   * Query params:
   *   project_id (required) — UUID of the project to fetch data for.
   *   days       (optional) — Number of days to look back for trends (default 90, max 365).
   */
  app.get('/v1/admin/code-health', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    // Resolve + authorise project.
    const projectIdParam = c.req.query('project_id') ?? ''
    if (!projectIdParam) {
      return c.json({ ok: false, error: { code: 'MISSING_PARAM', message: 'project_id is required' } }, 400)
    }

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404),
      overrideProjectId: projectIdParam,
    })
    if ('response' in resolved) return resolved.response
    const { project } = resolved
    const projectId = project.id as string

    const daysRaw = parseInt(c.req.query('days') ?? '90', 10)
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 365) : 90
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    // ── 1. Fetch metric_series (bundle + code_health metrics) ───────────────
    const { data: metricRows, error: metricErr } = await db
      .from('metric_series')
      .select('metric_name, dimension, value, ts')
      .eq('project_id', projectId)
      .or('metric_name.like.bundle.%,metric_name.like.code_health.%')
      .gte('ts', since)
      .order('ts', { ascending: true })
      .limit(2000)

    if (metricErr) {
      hlog.warn('metric_series fetch error', { err: metricErr.message, projectId })
    }

    const rows = (metricRows ?? []) as Array<{
      metric_name: string
      dimension: string | null
      value: number
      ts: string
    }>

    // Group metrics into trend buckets.
    const mobileTrends: Record<string, TrendPoint[]> = {}
    const webTrends: TrendPoint[] = []
    const godFileCounts: Record<string, TrendPoint[]> = {}
    const maxFileLoc: Record<string, TrendPoint[]> = {}

    for (const r of rows) {
      const point: TrendPoint = { ts: r.ts, value: r.value, dimension: r.dimension }
      if (r.metric_name === 'bundle.mobile.gzip_kb') {
        const dim = r.dimension ?? 'combined'
        ;(mobileTrends[dim] ??= []).push(point)
      } else if (r.metric_name === 'bundle.web.gzip_kb') {
        webTrends.push(point)
      } else if (r.metric_name === 'code_health.god_file_count') {
        const dim = r.dimension ?? 'all'
        ;(godFileCounts[dim] ??= []).push(point)
      } else if (r.metric_name === 'code_health.max_file_loc') {
        const dim = r.dimension ?? 'all'
        ;(maxFileLoc[dim] ??= []).push(point)
      }
    }

    // ── 2. Fetch latest code_health gate run ────────────────────────────────
    const { data: latestRun, error: runErr } = await db
      .from('gate_runs')
      .select('id, status, completed_at')
      .eq('project_id', projectId)
      .eq('gate', 'code_health')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (runErr) {
      hlog.warn('gate_runs fetch error', { err: runErr.message, projectId })
    }

    // ── 3. Fetch findings from the latest run ───────────────────────────────
    let godFiles: GodFileFinding[] = []
    if (latestRun?.id) {
      const { data: findingRows, error: findErr } = await db
        .from('gate_findings')
        .select('id, rule_id, severity, file_path, line, message, suggested_fix')
        .eq('gate_run_id', latestRun.id)
        .order('severity', { ascending: true }) // error first
        .limit(200)

      if (findErr) {
        hlog.warn('gate_findings fetch error', { err: findErr.message, projectId })
      }

      godFiles = (findingRows ?? []) as GodFileFinding[]
    }

    // ── 4. Compute summary ──────────────────────────────────────────────────
    const errorCount = godFiles.filter((f) => f.severity === 'error').length
    const warnCount = godFiles.filter((f) => f.severity === 'warn').length

    // Latest LOC from the most recent max_file_loc point.
    const allLocPoints = Object.values(maxFileLoc).flat()
    const maxLoc = allLocPoints.length > 0
      ? Math.max(...allLocPoints.map((p) => p.value))
      : null

    // Latest combined bundle KB. The web + mobile arrays are each sorted by ts,
    // but concatenating them loses global chronological order, so pick the point
    // with the most recent ts (ISO strings compare lexicographically).
    const allBundlePoints = [...webTrends, ...Object.values(mobileTrends).flat()]
    const latestBundleKb = allBundlePoints.length > 0
      ? allBundlePoints.reduce((latest, p) => (p.ts > latest.ts ? p : latest)).value
      : null

    const response: CodeHealthResponse = {
      trends: {
        mobile: mobileTrends,
        web: webTrends,
        godFileCounts,
        maxFileLoc,
      },
      godFiles,
      latestRunAt: latestRun?.completed_at ?? null,
      latestRunStatus: latestRun?.status ?? null,
      summary: {
        error_count: errorCount,
        warn_count: warnCount,
        max_loc: maxLoc,
        latest_bundle_kb: latestBundleKb,
      },
    }

    return c.json({ ok: true, data: response })
  })
}
