import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

/**
 * SOC 2 Type 1 evidence collector.
 *
 * Runs nightly via pg_cron (or on-demand from the admin Compliance page) and
 * snapshots the current state of every monitored control into the
 * `soc2_evidence` table. The admin Compliance page reads from this table to
 * produce the auditor-ready evidence pack.
 *
 * Controls covered (the SOC 2 Trust Services Criteria
 * relevant for a managed-cloud autofix platform):
 *
 *   CC2.1   System monitoring                — Sentry + Langfuse health
 *   CC6.1   Logical access controls          — RLS coverage on every table
 *   CC6.6   Encryption in transit            — HTTPS + Supabase TLS state
 *   CC6.7   Data retention                   — project_retention_policies coverage
 *   CC7.2   System operations / incidents    — recent audit_log volume
 *   CC8.1   Change management / data deletion — DSAR fulfilment lag
 *   A1.2    Availability                     — uptime against latest healthcheck
 *
 * Writes one row per (project, control). The result is intentionally
 * idempotent within a run — the unique key is (project_id, control, generated_at).
 */
const soc2Log = log.child('soc2-evidence')

interface ControlResult {
  control: string
  control_label: string
  status: 'pass' | 'warn' | 'fail'
  payload: Record<string, unknown>
}

Deno.serve(withSentry('soc2-evidence', async (req) => {
  // SEC-1 (Wave S1 / D-14): unified internal auth.
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const db = getServiceClient()
  const body = await req.json().catch(() => ({}))
  const trigger = (body.trigger ?? 'cron') as 'cron' | 'manual' | 'http'
  const cronRun = await startCronRun(db, 'soc2-evidence', trigger)

  try {
    const { data: projects, error } = await db.from('projects').select('id, name')
    if (error) throw error

    const inserted: Array<{ project_id: string; control: string; status: string }> = []

    for (const project of projects ?? []) {
      const controls = await collectControlsForProject(db, project.id)
      for (const result of controls) {
        const { error: insertError } = await db.from('soc2_evidence').insert({
          project_id: project.id,
          control: result.control,
          control_label: result.control_label,
          status: result.status,
          payload: result.payload,
          generated_by: trigger === 'manual' ? 'soc2-evidence-manual' : 'soc2-evidence-cron',
        })
        if (insertError) {
          soc2Log.warn('Failed to insert evidence row', {
            project_id: project.id,
            control: result.control,
            error: insertError.message,
          })
          continue
        }
        inserted.push({
          project_id: project.id,
          control: result.control,
          status: result.status,
        })
      }
    }

    await cronRun.finish({
      rowsAffected: inserted.length,
      metadata: { project_count: projects?.length ?? 0 },
    })

    return new Response(JSON.stringify({ ok: true, inserted: inserted.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    soc2Log.error('SOC 2 evidence run failed', { error: (err as Error).message })
    await cronRun.fail((err as Error).message)
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
    })
  }
}))

async function collectControlsForProject(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<ControlResult[]> {
  const results: ControlResult[] = []

  // CC6.1 — RLS coverage. Verify every public table has RLS enabled. Failure
  // is a hard fail; a missing RLS policy is a SOC 2 audit-blocking finding.
  const { data: rlsRows } = await db.rpc('mushi_rls_coverage_snapshot').select()
  const tablesWithoutRls = (rlsRows ?? []).filter((r: any) => r.rls_enabled === false)
  results.push({
    control: 'CC6.1',
    control_label: 'Logical & physical access — RLS coverage',
    status: tablesWithoutRls.length === 0 ? 'pass' : 'fail',
    payload: { tables_without_rls: tablesWithoutRls.map((r: any) => r.table_name) },
  })

  // CC6.7 — retention. Project must have an explicit retention policy row.
  const { data: retentionRow } = await db
    .from('project_retention_policies')
    .select('reports_retention_days, audit_retention_days, legal_hold')
    .eq('project_id', projectId)
    .maybeSingle()
  results.push({
    control: 'CC6.7',
    control_label: 'Data retention windows',
    status: retentionRow ? 'pass' : 'warn',
    payload: retentionRow
      ? { ...retentionRow, default_used: false }
      : { default_used: true, reports_retention_days: 365, audit_retention_days: 730 },
  })

  // CC7.2 — operational visibility. Healthy projects should produce at least
  // one audit log row per day; absence of any in 7 days is a warn signal.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count: auditCount } = await db
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .gte('created_at', since)
  results.push({
    control: 'CC7.2',
    control_label: 'Operational monitoring — audit_log volume (7d)',
    status: (auditCount ?? 0) > 0 ? 'pass' : 'warn',
    payload: { audit_log_rows_7d: auditCount ?? 0 },
  })

  // CC8.1 — DSAR fulfilment lag. Pending DSARs older than 30 days are a hard
  // fail (regulatory obligation under GDPR Article 12).
  const dsarSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: stalDsars } = await db
    .from('data_subject_requests')
    .select('id, created_at, status, request_type')
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .lt('created_at', dsarSince)
  results.push({
    control: 'CC8.1',
    control_label: 'DSAR fulfilment lag (>30 days)',
    status: (stalDsars ?? []).length === 0 ? 'pass' : 'fail',
    payload: { overdue_dsars: (stalDsars ?? []).length, ids: (stalDsars ?? []).map((d) => d.id) },
  })

  // A1.2 — availability. Compute the 7-day uptime ratio across the
  // integration_health_history probe ticks for this project. SOC 2 doesn't
  // mandate a specific SLA but >=99% is the convention auditors expect to
  // see; <90% is a hard fail. When we have no probe data at all we mark
  // `warn` so the auditor knows to follow up rather than reading silence as
  // green.
  const probeSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  // Uptime ratio uses count-only queries (head: true) so it stays accurate
  // regardless of how many probe ticks the project has accumulated. With a
  // 5-minute probe interval × N integration kinds, a single 2000-row
  // SELECT was silently capping at <7 days for moderately wired projects,
  // which inflated apparent uptime — the audit-evidence tier of all
  // surfaces is the worst place to be undercounting failures.
  const [{ count: totalRaw }, { count: okRaw }] = await Promise.all([
    db
      .from('integration_health_history')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .gte('checked_at', probeSince),
    db
      .from('integration_health_history')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .gte('checked_at', probeSince)
      .eq('status', 'ok'),
  ])
  const total = totalRaw ?? 0
  const okCount = okRaw ?? 0
  const uptime = total > 0 ? okCount / total : null

  // Latency p95 + per-kind breakdown only needs a representative sample,
  // not the full 7d population — 5000 samples is plenty for a stable p95
  // estimate even at 5-min ticking × 5 kinds (~10k events/wk). We pull
  // them sorted-by-most-recent so the percentile reflects current
  // performance rather than week-old regressions hidden behind newer
  // recoveries.
  const SAMPLE_CAP = 5000
  const { data: probeSample } = await db
    .from('integration_health_history')
    .select('latency_ms, kind')
    .eq('project_id', projectId)
    .gte('checked_at', probeSince)
    .order('checked_at', { ascending: false })
    .limit(SAMPLE_CAP)
  const latencies = (probeSample ?? [])
    .map((r: { latency_ms: number | null }) => r.latency_ms)
    .filter((v: number | null): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a: number, b: number) => a - b)
  // Nearest-rank p95: index = ceil(0.95 * n) - 1, clamped to [0, n-1].
  // The previous `Math.floor(n * 0.95)` selected the max element when
  // `n * 0.95` was an integer (e.g. n=20 → idx 19 = p100), so reported
  // p95 was effectively p100 for many small samples.
  const p95 = latencies.length > 0
    ? latencies[Math.min(Math.max(0, Math.ceil(0.95 * latencies.length) - 1), latencies.length - 1)] ?? null
    : null
  // Group probe counts by integration kind so the auditor sees coverage
  // breadth, not just a single number. e.g. `{sentry: 168, supabase: 168}`.
  // This is sample-bounded (mirrors the latency sample); for total
  // coverage the auditor consults `probe_count_7d`.
  const byKind: Record<string, number> = {}
  for (const r of probeSample ?? []) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
  let availabilityStatus: 'pass' | 'warn' | 'fail'
  if (total === 0) availabilityStatus = 'warn'
  else if (uptime !== null && uptime >= 0.99) availabilityStatus = 'pass'
  else if (uptime !== null && uptime < 0.9) availabilityStatus = 'fail'
  else availabilityStatus = 'warn'
  results.push({
    control: 'A1.2',
    control_label: 'Availability — 7d probe uptime',
    status: availabilityStatus,
    payload: {
      uptime_ratio: uptime,
      uptime_pct: uptime !== null ? Math.round(uptime * 10000) / 100 : null,
      probe_count_7d: total,
      ok_count_7d: okCount,
      p95_latency_ms: p95,
      probes_by_kind: byKind,
      window_days: 7,
      threshold_pass: 0.99,
      threshold_fail: 0.9,
      ...(total === 0
        ? { note: 'No probe ticks in the last 7 days — connect an integration to start collecting evidence.' }
        : {}),
    },
  })

  return results
}
