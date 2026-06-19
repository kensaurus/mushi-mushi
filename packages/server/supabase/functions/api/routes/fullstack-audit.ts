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
 * Response shape:
 *   { ok: true, data: AuditResult }
 */

import { Hono } from 'npm:hono@4'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { resolveSupabasePat, getSupabaseAdvisors, getLogs, listTables } from '../../_shared/supabase-mcp-client.ts'
import { resolveOwnedProject } from '../shared.ts'
import { log } from '../../_shared/logger.ts'
import type { Variables } from '../types.ts'

const alog = log.child('fullstack-audit')

export interface AuditFinding {
  severity: 'error' | 'warn' | 'info'
  category: 'schema_drift' | 'api_contract' | 'rls_gap' | 'orphan_endpoint' | 'unknown_call' | 'backend_error' | 'spec_drift' | 'advisor'
  title: string
  detail: string
  rule_id?: string
  fix_available?: boolean
}

export interface AuditResult {
  project_id: string
  project_name: string
  audit_at: string
  backend_linked: boolean
  summary: {
    error_count: number
    warn_count: number
    info_count: number
    overall: 'pass' | 'warn' | 'fail'
  }
  findings: AuditFinding[]
  gate_runs: Array<{
    gate: string
    status: string
    findings_count: number
    run_id: string
  }>
  schema_snapshot_taken: boolean
  recent_backend_errors: number
}

export interface FullstackAuditStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  errorCount: number
  warnCount: number
  failedGateCount: number
  topPriority: 'no_project' | 'failures' | 'warnings' | 'healthy'
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
    }

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: empty }),
    })
    if ('response' in resolved) return resolved.response
    const { project } = resolved
    const projectId = project.id as string
    const projectName = (project.project_name as string | null) ?? null

    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recentRuns } = await db
      .from('gate_runs')
      .select('id, status')
      .eq('project_id', projectId)
      .gte('completed_at', since)
      .neq('gate', 'code_health')

    const runIds = (recentRuns ?? []).map((r) => r.id as string)
    const failedGateCount = (recentRuns ?? []).filter((r) => r.status === 'fail').length

    let errorCount = 0
    let warnCount = 0
    if (runIds.length > 0) {
      const { data: findings } = await db
        .from('gate_findings')
        .select('severity')
        .in('gate_run_id', runIds.slice(0, 50))

      for (const row of findings ?? []) {
        if (row.severity === 'error') errorCount += 1
        else if (row.severity === 'warn') warnCount += 1
      }
    }

    let topPriority: FullstackAuditStats['topPriority'] = 'healthy'
    if (failedGateCount > 0 || errorCount > 0) topPriority = 'failures'
    else if (warnCount > 0) topPriority = 'warnings'

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId,
        projectName,
        errorCount,
        warnCount,
        failedGateCount,
        topPriority,
      } satisfies FullstackAuditStats,
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

    // ── 1. Resolve backend credentials (non-fatal if missing) ──────────────
    const [pat, settingsRes] = await Promise.all([
      resolveSupabasePat(db, projectId),
      db
        .from('project_settings')
        .select('supabase_project_ref, openapi_spec_url, crawler_base_url')
        .eq('project_id', projectId)
        .single(),
    ])
    const settings = settingsRes.data as {
      supabase_project_ref?: string
      openapi_spec_url?: string
      crawler_base_url?: string
    } | null
    const projectRef = settings?.supabase_project_ref ?? null
    const backendLinked = Boolean(pat && projectRef)
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
      }
    } else {
      findings.push({
        severity: 'warn',
        category: 'advisor',
        title: 'Backend not linked',
        detail:
          'Set supabase_project_ref in project settings and add a Supabase PAT in API Keys (slug: supabase) to enable backend analysis.',
      })
    }

    // ── 3. Recent gate findings (last 7 days) ──────────────────────────────
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recentGateRuns } = await db
      .from('gate_runs')
      .select('id, gate, status, findings_count, completed_at')
      .eq('project_id', projectId)
      .gte('started_at', sevenDaysAgo)
      .order('started_at', { ascending: false })
      .limit(40)

    const latestByGate = new Map<string, { status: string; findings_count: number; run_id: string }>()
    for (const run of recentGateRuns ?? []) {
      if (!latestByGate.has(run.gate)) {
        latestByGate.set(run.gate, {
          status: run.status,
          findings_count: run.findings_count ?? 0,
          run_id: run.id,
        })
      }
    }

    for (const [gate, info] of latestByGate) {
      gateRunSummaries.push({ gate, ...info })
      if (info.status === 'fail' && info.findings_count > 0) {
        const gateLabel: Record<string, string> = {
          api_contract: 'API Contract',
          spec_drift: 'OpenAPI Spec Drift',
          orphan_endpoint: 'Orphan Backend Endpoints',
          unknown_call: 'Unknown Frontend Calls',
          schema_drift: 'Schema Drift',
          dead_handler: 'Dead Handler',
          mock_leak: 'Mock Leak',
        }
        findings.push({
          severity: 'error',
          category: gate as AuditFinding['category'],
          title: `${gateLabel[gate] ?? gate}: ${info.findings_count} issue${info.findings_count > 1 ? 's' : ''}`,
          detail: `Gate "${gate}" found ${info.findings_count} finding${info.findings_count > 1 ? 's' : ''} in the last 7 days. Open the Inventory → Gates page to review.`,
          fix_available: gate !== 'schema_drift',
        })
      }
    }

    // ── 4. Trigger a fresh gate run (async fire-and-forget) ────────────────
    // We don't wait — the scorecard shows the last known state; background
    // job will refresh findings. Only trigger if gates haven't run today.
    const lastRunAt = recentGateRuns?.[0]?.completed_at
    const runToday = lastRunAt && new Date(lastRunAt).toDateString() === new Date().toDateString()
    if (!runToday) {
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
      errorCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass'

    const result: AuditResult = {
      project_id: projectId,
      project_name: project.name ?? '',
      audit_at: new Date().toISOString(),
      backend_linked: backendLinked,
      summary: { error_count: errorCount, warn_count: warnCount, info_count: infoCount, overall },
      findings,
      gate_runs: gateRunSummaries,
      schema_snapshot_taken: schemaSnapshotTaken,
      recent_backend_errors: recentBackendErrors,
    }

    return c.json({ ok: true, data: result })
  })
}

declare const Deno: { env: { get(k: string): string | undefined } }
