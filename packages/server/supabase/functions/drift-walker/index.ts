/**
 * drift-walker — Phase 4b
 *
 * Supabase Edge Function that:
 *   1. Triggers contract-graph-builder to build/refresh the snapshot
 *   2. Loads the latest snapshot + historical findings
 *   3. Runs walkContractDrift (Thompson-sampled path priority — Phase 4c)
 *   4. Persists new drift_findings
 *   5. Promotes high-signal findings as candidate lessons (Phase 4c feedback loop)
 *
 * Every read and write is checked: a failed step returns 500 with the step
 * that failed. The response carries the builder's per-source states, so a
 * walk over a snapshot with no OpenAPI spec reads as "not configured", not
 * as "no drift".
 *
 * POST body: { project_id: string, max_paths?: number }
 * Triggered from the console (POST /v1/admin/drift/scan); no cron.
 */

import { walkContractDrift } from '../_shared/drift-agent.ts'
import { getServiceClient } from '../_shared/db.ts'
import { withSentry, reportError } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { createEmbedding } from '../_shared/embeddings.ts'

function fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

Deno.serve(
  withSentry('drift-walker', async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const authErr = requireServiceRoleAuth(req)
    if (authErr) return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({}))
    const projectId: string | null = typeof body.project_id === 'string' ? body.project_id : null
    const maxPaths: number = typeof body.max_paths === 'number' ? body.max_paths : 200
    if (!projectId) return fail(400, 'project_id required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceKey) return fail(500, 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')

    // 1. Build/refresh contract snapshot
    let builderJson: { ok?: boolean; snapshot_id?: string; error?: string; sources?: unknown } = {}
    try {
      const builderRes = await fetch(`${supabaseUrl}/functions/v1/contract-graph-builder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
        body: JSON.stringify({ project_id: projectId }),
        signal: AbortSignal.timeout(60_000),
      })
      builderJson = await builderRes.json().catch(() => ({ error: `HTTP ${builderRes.status}, non-JSON body` }))
      if (!builderRes.ok || !builderJson.snapshot_id) {
        return fail(502, 'contract-graph-builder failed', { detail: builderJson.error ?? `HTTP ${builderRes.status}` })
      }
    } catch (err) {
      return fail(502, 'contract-graph-builder unreachable', { detail: String(err).slice(0, 300) })
    }
    const snapshotId = builderJson.snapshot_id

    // 2. Load snapshot
    const { data: snapshot, error: snapErr } = await db
      .from('contract_snapshots')
      .select('id, openapi, inventory_nodes, pg_schema')
      .eq('id', snapshotId)
      .single()
    if (snapErr || !snapshot) return fail(500, `contract_snapshots: ${snapErr?.message ?? 'not found'}`)

    // 3. Load historical findings for Thompson sampling (Phase 4c)
    const { data: historicalFindings, error: histErr } = await db
      .from('drift_findings')
      .select('path, finding_type')
      .eq('project_id', projectId)
      .limit(500)
    if (histErr) return fail(500, `drift_findings history: ${histErr.message}`)

    // 4. Walk for drift
    const findings = walkContractDrift(
      { id: snapshot.id, openapi: snapshot.openapi, inventory_nodes: snapshot.inventory_nodes, pg_schema: snapshot.pg_schema },
      historicalFindings ?? [],
      maxPaths,
    )

    // 5. Persist findings (deduplicate by finding_type + path + surface within last 24h)
    const { data: recent, error: recentErr } = await db
      .from('drift_findings')
      .select('finding_type, path, surface')
      .eq('project_id', projectId)
      .eq('status', 'open')
      .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
    if (recentErr) return fail(500, `drift_findings recent: ${recentErr.message}`)

    const recentKeys = new Set(
      (recent ?? []).map(f => `${f.finding_type}:${f.surface}:${f.path}`)
    )

    const newFindings = findings.filter(f =>
      !recentKeys.has(`${f.finding_type}:${f.surface}:${f.path ?? ''}`)
    )

    let inserted = 0
    if (newFindings.length > 0) {
      const rows = newFindings.map(f => ({
        project_id: projectId,
        snapshot_id: snapshotId,
        finding_type: f.finding_type,
        severity: f.severity,
        surface: f.surface,
        path: f.path,
        message: f.message,
        expected: f.expected ?? null,
        actual: f.actual ?? null,
      }))
      const { count, error: insErr } = await db.from('drift_findings').insert(rows, { count: 'exact' })
      if (insErr) return fail(500, `drift_findings insert: ${insErr.message}`)
      inserted = count ?? rows.length
    }

    // 6. Phase 4c: promote high-severity findings as candidate lessons
    const criticalFindings = newFindings.filter(f => f.severity === 'critical')
    const promoteErrors: string[] = []
    for (const finding of criticalFindings.slice(0, 5)) {
      // Insert a candidate cluster entry so the mistake-clusterer can pick it
      // up. mistake_clusters.centroid is NOT NULL vector(1536): without an
      // embedding every insert failed, and the old code swallowed it.
      let centroid: number[]
      try {
        centroid = await createEmbedding(finding.message, { projectId })
      } catch (err) {
        promoteErrors.push(`embedding: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`)
        continue
      }
      const { error: clusterErr } = await db.from('mistake_clusters').insert({
        project_id: projectId,
        centroid: JSON.stringify(centroid),
        status: 'candidate',
        name: `[Drift] ${finding.finding_type}`,
        summary: finding.message,
        suggested_rule: `Fix: ${finding.message}`,
        cluster_size: 1,
        severity_distribution: { critical: 1 },
      })
      if (clusterErr) promoteErrors.push(clusterErr.message)
    }
    if (promoteErrors.length > 0) {
      // The findings are saved; the lesson promotion is the part that failed.
      reportError(new Error(`drift-walker lesson promotion failed: ${promoteErrors[0]}`), {
        tags: { function: 'drift-walker', stage: 'promote' },
        extra: { projectId, failures: promoteErrors.length },
      })
    }

    return new Response(
      JSON.stringify({
        ok: true,
        snapshot_id: snapshotId,
        sources: builderJson.sources ?? null,
        findings_found: findings.length,
        findings_inserted: inserted,
        critical_promoted: Math.min(criticalFindings.length, 5) - promoteErrors.length,
        promote_errors: promoteErrors,
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
)
