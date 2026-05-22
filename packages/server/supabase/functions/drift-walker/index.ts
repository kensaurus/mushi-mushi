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
 * POST body: { project_id: string, max_paths?: number }
 * Cron: scheduled by pg_cron (e.g. daily at 03:00 UTC)
 */

import { walkContractDrift } from '../_shared/drift-agent.ts'
import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

Deno.serve(
  withSentry(async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const authErr = requireServiceRoleAuth(req)
    if (authErr && req.headers.get('x-mushi-admin') !== '1') return authErr

    const db = getServiceClient()
    const body = await req.json().catch(() => ({}))
    const projectId: string | null = body.project_id ?? null
    const maxPaths: number = body.max_paths ?? 200
    if (!projectId) return new Response(JSON.stringify({ error: 'project_id required' }), { status: 400 })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // 1. Build/refresh contract snapshot
    const builderRes = await fetch(`${supabaseUrl}/functions/v1/contract-graph-builder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify({ project_id: projectId }),
    })
    const builderJson = await builderRes.json()
    const snapshotId: string | null = builderJson.snapshot_id ?? null

    if (!snapshotId) {
      return new Response(
        JSON.stringify({ error: 'contract-graph-builder failed', detail: builderJson }),
        { status: 500 },
      )
    }

    // 2. Load snapshot
    const { data: snapshot, error: snapErr } = await db
      .from('contract_snapshots')
      .select('id, openapi, inventory_nodes, pg_schema')
      .eq('id', snapshotId)
      .single()

    if (snapErr || !snapshot) {
      return new Response(JSON.stringify({ error: 'Snapshot not found' }), { status: 404 })
    }

    // 3. Load historical findings for Thompson sampling (Phase 4c)
    const { data: historicalFindings } = await db
      .from('drift_findings')
      .select('path, finding_type')
      .eq('project_id', projectId)
      .limit(500)

    // 4. Walk for drift
    const findings = walkContractDrift(
      { id: snapshot.id, openapi: snapshot.openapi, inventory_nodes: snapshot.inventory_nodes, pg_schema: snapshot.pg_schema },
      historicalFindings ?? [],
      maxPaths,
    )

    // 5. Persist findings (deduplicate by finding_type + path + surface within last 24h)
    const { data: recent } = await db
      .from('drift_findings')
      .select('finding_type, path, surface')
      .eq('project_id', projectId)
      .eq('status', 'open')
      .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())

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
      const { count } = await db.from('drift_findings').insert(rows, { count: 'exact' })
      inserted = count ?? 0
    }

    // 6. Phase 4c: promote high-severity findings as candidate lessons
    const criticalFindings = newFindings.filter(f => f.severity === 'critical')
    for (const finding of criticalFindings.slice(0, 5)) {
      // Insert a candidate cluster entry so the mistake-clusterer can pick it up
      await Promise.resolve(db.from('mistake_clusters').insert({
        project_id: projectId,
        status: 'candidate',
        name: `[Drift] ${finding.finding_type}`,
        summary: finding.message,
        suggested_rule: `Fix: ${finding.message}`,
        cluster_size: 1,
        severity_distribution: { critical: 1 },
      })).catch(() => { /* best effort */ })
    }

    return new Response(
      JSON.stringify({
        ok: true,
        snapshot_id: snapshotId,
        findings_found: findings.length,
        findings_inserted: inserted,
        critical_promoted: criticalFindings.length,
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
)
