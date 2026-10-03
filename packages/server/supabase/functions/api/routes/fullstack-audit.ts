/**
 * fullstack-audit.ts — One-click PM Full-Stack Audit for a project.
 *
 * POST /v1/admin/projects/:id/audit
 *   Fans out to: DB advisors + schema diff + backend logs (errors) +
 *   gate runs (3–8) + crawler health. Collects results, computes a
 *   PM-readable severity scorecard, and returns it in a single response.
 *
 *   The audit is intentionally synchronous (max ~10 s wall clock with the
 *   MCP cache) so the PM sees a result in one page load. For large projects
 *   individual gate runs are already async; we return whatever completes
 *   within the Supabase edge-function 25-second timeout.
 *
 * Fail-open rule (Plan 020 P-1): a read that fails is listed in `read_errors`
 * (stats: `readError`) and the verdict is `unknown`, never "pass" or
 * "healthy" built from rows that were never read.
 *
 * Response shape:
 *   { ok: true, data: AuditResult }
 */

import { Hono } from 'npm:hono@4'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { readAllPages, type PageCount } from '../../_shared/paged-read.ts'
import { resolveSupabasePat, getSupabaseAdvisors, getLogs, listTables } from '../../_shared/supabase-mcp-client.ts'
import { resolveOwnedProject } from '../shared.ts'
import { log } from '../../_shared/logger.ts'
import type { Variables } from '../types.ts'

const alog = log.child('fullstack-audit')

type Db = ReturnType<typeof getServiceClient>

export interface AuditFinding {
  severity: 'error' | 'warn' | 'info'
  category: 'schema_drift' | 'api_contract' | 'rls_gap' | 'orphan_endpoint' | 'unknown_call' | 'backend_error' | 'spec_drift' | 'advisor' | 'gate'
  title: string
  detail: string
  rule_id?: string
  fix_available?: boolean
}

export interface AuditResult {
  project_id: string
  project_name: string
  audit_at: string
  /** null when the project settings could not be read. */
  backend_linked: boolean | null
  summary: {
    error_count: number
    warn_count: number
    info_count: number
    /** `unknown`: no error was found, but at least one read failed (see read_errors). */
    overall: 'pass' | 'warn' | 'fail' | 'unknown'
  }
  findings: AuditFinding[]
  gate_runs: Array<{
    gate: string
    status: string
    findings_count: number
    run_id: string
  }>
  /** False when the gate runs could not be read: an empty gate_runs is then unknown, not "none". */
  gate_runs_read: boolean
  schema_snapshot_taken: boolean
  recent_backend_errors: number
  /** Plain-English list of the reads that failed; empty when the audit is complete. */
  read_errors: string[]
}

export interface FullstackAuditStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  errorCount: number
  warnCount: number
  failedGateCount: number
  /** `unknown`: a read failed, so the counts are not known (see readError). */
  topPriority: 'no_project' | 'failures' | 'warnings' | 'healthy' | 'unknown'
  readError: string | null
}

/** Plain-English gate names for audit finding titles (same wording as the console). */
const GATE_TITLES: Record<string, string> = {
  dead_handler: 'Dead handlers',
  mock_leak: 'Mock data in production code',
  api_contract: 'API contract',
  crawl: 'Live route crawl',
  status_claim: 'Status claims',
  spec_drift: 'OpenAPI spec drift',
  orphan_endpoint: 'Orphan backend endpoints',
  unknown_call: 'Unknown frontend calls',
  schema_drift: 'Schema drift',
  code_health: 'Code health',
  design_drift: 'Design drift',
  ci_drift: 'CI drift',
  deploy_drift: 'Deploy drift',
  env_drift: 'Env var drift',
  radar: 'Mushi setup checks',
  portfolio_radar: 'App hole checks',
  portfolio_radar_ci: 'App hole checks (host CI)',
  store_review: 'Store review checklist',
}

/** Gates whose every run restates the current state: only the newest counts. */
const RESTATING_GATES = ['radar', 'portfolio_radar', 'portfolio_radar_ci']
const STATS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const AUDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const COUNT_CHUNK = 100
const MAX_AUDIT_RUNS = 2_000
const MAX_STATS_RUNS = 10_000

type StatsCounts = Pick<FullstackAuditStats, 'errorCount' | 'warnCount' | 'failedGateCount' | 'topPriority' | 'readError'>

function unknownStats(readError: string): StatsCounts {
  return { errorCount: 0, warnCount: 0, failedGateCount: 0, topPriority: 'unknown', readError }
}

/**
 * Counts for the sidebar badge and the readout: failed gate runs and open
 * (not allowlisted) error / warn findings over 14 days. Restating gates count
 * their newest run only, so one problem is not counted once a day. Any failed
 * read returns `unknown`, never `healthy`.
 */
export async function readFullstackAuditStats(db: Db, projectId: string, nowMs: number): Promise<StatsCounts> {
  const since = new Date(nowMs - STATS_WINDOW_MS).toISOString()
  type StatsRun = { id: string; status: string }
  const pageRuns = (from: number, to: number, count: PageCount) => {
    let q = db
      .from('gate_runs')
      .select('id, status', { count })
      .eq('project_id', projectId)
      .gte('completed_at', since)
      .neq('gate', 'code_health')
    for (const g of RESTATING_GATES) q = q.neq('gate', g)
    return q.order('completed_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
  }
  const [runsRead, ...restatingRes] = await Promise.all([
    readAllPages<StatsRun>(pageRuns, { what: 'gate_runs', maxRows: MAX_STATS_RUNS }).catch((err: unknown) => {
      alog.warn('audit stats: gate_runs read failed', { projectId, err: err instanceof Error ? err.message : String(err) })
      return null
    }),
    ...RESTATING_GATES.map((gate) =>
      db
        .from('gate_runs')
        .select('id, status')
        .eq('project_id', projectId)
        .eq('gate', gate)
        .gte('completed_at', since)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()),
  ])
  const failedRead = restatingRes.find((r) => r.error)
  if (failedRead?.error) {
    alog.warn('audit stats: gate_runs read failed', { projectId, err: failedRead.error.message })
  }
  if (!runsRead || failedRead?.error) return unknownStats('The recent check runs could not be read.')
  // Counts over a cut-short list would read low (or "healthy"): unknown instead.
  if (runsRead.truncated) {
    alog.warn('audit stats: gate_runs read truncated', { projectId, total: runsRead.total })
    return unknownStats(`More than ${MAX_STATS_RUNS.toLocaleString('en-US')} check runs in 14 days, so the counts are not known.`)
  }
  const recentRuns = [
    ...runsRead.rows,
    ...restatingRes.map((r) => r.data as StatsRun | null).filter((r): r is StatsRun => r !== null),
  ]
  const failedGateCount = recentRuns.filter((r) => r.status === 'fail').length

  let errorCount = 0
  let warnCount = 0
  const runIds = recentRuns.map((r) => r.id)
  for (let i = 0; i < runIds.length; i += COUNT_CHUNK) {
    const chunk = runIds.slice(i, i + COUNT_CHUNK)
    const [errRes, warnRes] = await Promise.all(
      (['error', 'warn'] as const).map((severity) =>
        db
          .from('gate_findings')
          .select('id', { count: 'exact', head: true })
          .in('gate_run_id', chunk)
          .eq('severity', severity)
          .eq('allowlisted', false)),
    )
    const bad = errRes.error ?? warnRes.error
    if (bad || typeof errRes.count !== 'number' || typeof warnRes.count !== 'number') {
      alog.warn('audit stats: gate_findings count failed', { projectId, err: bad?.message ?? 'no count returned' })
      return unknownStats('The open findings could not be counted.')
    }
    errorCount += errRes.count
    warnCount += warnRes.count
  }

  const topPriority: StatsCounts['topPriority'] = failedGateCount > 0 || errorCount > 0 ? 'failures' : warnCount > 0 ? 'warnings' : 'healthy'
  return { errorCount, warnCount, failedGateCount, topPriority, readError: null }
}

interface GateRunRow {
  id: string
  gate: string
  status: string
  findings_count: number | null
  completed_at: string | null
}

/** The newest run per gate over the last 7 days, or an error message when the runs could not be read. */
export async function readLatestGateRuns(
  db: Db,
  projectId: string,
  nowMs: number,
): Promise<{ ok: true; runs: GateRunRow[]; latestByGate: Map<string, GateRunRow>; truncated: boolean } | { ok: false; message: string }> {
  const since = new Date(nowMs - AUDIT_WINDOW_MS).toISOString()
  try {
    const read = await readAllPages<GateRunRow>(
      (from, to, count) => db
        .from('gate_runs')
        .select('id, gate, status, findings_count, completed_at', { count })
        .eq('project_id', projectId)
        .gte('started_at', since)
        .order('started_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
      { what: 'gate_runs', maxRows: MAX_AUDIT_RUNS },
    )
    const latestByGate = new Map<string, GateRunRow>()
    for (const run of read.rows) if (!latestByGate.has(run.gate)) latestByGate.set(run.gate, run)
    return { ok: true, runs: read.rows, latestByGate, truncated: read.truncated }
  } catch (err) {
    alog.warn('audit: gate_runs read failed', { projectId, err: err instanceof Error ? err.message : String(err) })
    return { ok: false, message: 'The gate runs of the last 7 days could not be read.' }
  }
}

export function registerFullstackAuditRoutes(parent: Hono<{ Variables: Variables }>) {
  parent.get('/v1/admin/fullstack-audit/stats', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const empty: FullstackAuditStats = {
      hasAnyProject: false,
      projectId: null,
      projectName: null,
      errorCount: 0,
      warnCount: 0,
      failedGateCount: 0,
      topPriority: 'no_project',
      readError: null,
    }

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: empty }),
    })
    if ('response' in resolved) return resolved.response
    const { project } = resolved
    const projectId = project.id as string
    const projectName = (project.name as string | null) ?? null

    const counts = await readFullstackAuditStats(db, projectId, Date.now())
    return c.json({
      ok: true,
      data: { hasAnyProject: true, projectId, projectName, ...counts } satisfies FullstackAuditStats,
    })
  })

  parent.post('/v1/admin/projects/:id/audit', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('id')!
    const db = getServiceClient()

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404),
      overrideProjectId: projectId,
    })
    if ('response' in resolved) return resolved.response
    const { project } = resolved

    const findings: AuditFinding[] = []
    const gateRunSummaries: AuditResult['gate_runs'] = []
    const readErrors: string[] = []

    // ── 1. Resolve backend credentials (non-fatal if missing) ──────────────
    const [pat, settingsRes] = await Promise.all([
      resolveSupabasePat(db, projectId),
      db
        .from('project_settings')
        .select('supabase_project_ref, openapi_spec_url, crawler_base_url')
        .eq('project_id', projectId)
        .maybeSingle(),
    ])
    if (settingsRes.error) {
      alog.warn('audit: project_settings read failed', { projectId, err: settingsRes.error.message })
      readErrors.push('The project settings could not be read, so whether a backend is linked is unknown.')
    }
    const settings = settingsRes.data as {
      supabase_project_ref?: string
      openapi_spec_url?: string
      crawler_base_url?: string
    } | null
    const projectRef = settings?.supabase_project_ref ?? null
    const backendLinked = settingsRes.error ? null : Boolean(pat && projectRef)
    let recentBackendErrors = 0
    let schemaSnapshotTaken = false

    // ── 2. DB advisors + schema + logs (parallel, only if backend linked) ──
    if (backendLinked && pat && projectRef) {
      const mcpOpts = { projectRef, pat }

      const [advisors, logs, tables] = await Promise.allSettled([
        getSupabaseAdvisors(mcpOpts),
        getLogs(mcpOpts, 'api', { limit: 50, minLevel: 'error' }),
        listTables(mcpOpts),
      ])

      if (advisors.status === 'fulfilled') {
        for (const a of advisors.value) {
          const sev = (a.level === 'ERROR' || a.level === 'error') ? 'error' : 'warn'
          findings.push({
            severity: sev as AuditFinding['severity'],
            category: 'advisor',
            title: a.title ?? a.name,
            detail: a.description,
            rule_id: a.name,
            fix_available: sev === 'error',
          })
        }
      } else {
        readErrors.push('The Supabase advisors could not be read.')
      }

      if (logs.status === 'fulfilled') {
        recentBackendErrors = logs.value.length
        if (recentBackendErrors > 0) {
          findings.push({
            severity: recentBackendErrors > 10 ? 'error' : 'warn',
            category: 'backend_error',
            title: `${recentBackendErrors} recent backend error${recentBackendErrors > 1 ? 's' : ''}`,
            detail: `The last 50 API log entries contain ${recentBackendErrors} ERROR-level events. Check the Logs tab for details.`,
          })
        }
      } else {
        readErrors.push('The backend logs could not be read.')
      }

      if (tables.status === 'fulfilled') {
        // Check for tables with RLS disabled — common security gap.
        const noRlsTables = tables.value.filter((t) => !t.rls_enabled)
        for (const t of noRlsTables.slice(0, 10)) {
          findings.push({
            severity: 'error',
            category: 'rls_gap',
            title: `Table "${t.name}" has RLS disabled`,
            detail: `Row Level Security is off on ${t.schema}.${t.name}. Any authenticated user can read all rows. Enable RLS and add at least one policy.`,
            rule_id: 'rls-disabled',
            fix_available: true,
          })
        }
        schemaSnapshotTaken = tables.value.length > 0
      } else {
        readErrors.push('The table list could not be read, so RLS was not checked.')
      }
    } else if (backendLinked === false) {
      findings.push({
        severity: 'warn',
        category: 'advisor',
        title: 'Backend not linked',
        detail:
          'Set supabase_project_ref in project settings and add a Supabase PAT in API Keys (slug: supabase) to enable backend analysis.',
      })
    }

    // ── 3. Recent gate findings (last 7 days) ──────────────────────────────
    const gateRead = await readLatestGateRuns(db, projectId, Date.now())
    if (!gateRead.ok) {
      readErrors.push(gateRead.message)
    } else {
      if (gateRead.truncated) {
        readErrors.push(`Only the newest ${MAX_AUDIT_RUNS.toLocaleString('en-US')} gate runs of the last 7 days were read; a gate that last ran before them is missing.`)
      }
      for (const [gate, run] of gateRead.latestByGate) {
        const info = { status: run.status, findings_count: run.findings_count ?? 0, run_id: run.id }
        gateRunSummaries.push({ gate, ...info })
        if (info.status === 'fail' && info.findings_count > 0) {
          const category: AuditFinding['category'] =
            gate === 'api_contract' || gate === 'spec_drift' || gate === 'orphan_endpoint' || gate === 'unknown_call' || gate === 'schema_drift'
              ? gate
              : 'gate'
          findings.push({
            severity: 'error',
            category,
            title: `${GATE_TITLES[gate] ?? gate}: ${info.findings_count} issue${info.findings_count > 1 ? 's' : ''}`,
            detail: `Gate "${gate}" found ${info.findings_count} finding${info.findings_count > 1 ? 's' : ''} in the last 7 days. Open the Inventory → Gates page to review.`,
            fix_available: gate !== 'schema_drift',
          })
        }
      }
    }

    // ── 4. Trigger a fresh gate run (async fire-and-forget) ────────────────
    // We don't wait — the scorecard shows the last known state; background
    // job will refresh findings. Only trigger if gates haven't run today, and
    // only when the runs were actually read (an unread list is not "none today").
    const lastRunAt = gateRead.ok ? gateRead.runs[0]?.completed_at : undefined
    const runToday = lastRunAt && new Date(lastRunAt).toDateString() === new Date().toDateString()
    if (gateRead.ok && !runToday) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      if (supabaseUrl && serviceKey) {
        void fetch(`${supabaseUrl}/functions/v1/inventory-gates`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            project_id: projectId,
            gates: ['api_contract', 'status_claim', 'orphan_endpoint', 'unknown_call'],
            triggered_by: 'fullstack-audit',
          }),
        }).catch((err) => alog.warn('async gate run failed', { err: String(err) }))
      }
    }

    // ── 5. Compute summary ─────────────────────────────────────────────────
    const errorCount = findings.filter((f) => f.severity === 'error').length
    const warnCount = findings.filter((f) => f.severity === 'warn').length
    const infoCount = findings.filter((f) => f.severity === 'info').length
    const overall: AuditResult['summary']['overall'] =
      errorCount > 0 ? 'fail' : readErrors.length > 0 ? 'unknown' : warnCount > 0 ? 'warn' : 'pass'

    const result: AuditResult = {
      project_id: projectId,
      project_name: project.name ?? '',
      audit_at: new Date().toISOString(),
      backend_linked: backendLinked,
      summary: { error_count: errorCount, warn_count: warnCount, info_count: infoCount, overall },
      findings,
      gate_runs: gateRunSummaries,
      gate_runs_read: gateRead.ok,
      schema_snapshot_taken: schemaSnapshotTaken,
      recent_backend_errors: recentBackendErrors,
      read_errors: readErrors,
    }

    return c.json({ ok: true, data: result })
  })
}

declare const Deno: { env: { get(k: string): string | undefined } }
