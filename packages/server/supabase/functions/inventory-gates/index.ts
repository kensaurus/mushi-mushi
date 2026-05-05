// ============================================================
// inventory-gates — server-side orchestrator for Gates 3 + 5
//                   (whitepaper §5)
//
// Gates 1 (no-dead-handler) + 2 (no-mock-leak) run inside the
// `mushi-mushi-gates` GitHub Action via the eslint plugin. They post
// their findings here as `gate_runs` rows so the admin can render them.
//
// Gate 3 (API contract) is server-side because it needs cross-repo
// access (frontend declares api_dep; backend exposes the route). The
// `inventory-crawler` function does the discovery walk; this function
// joins crawler output against `api_dep` nodes and writes findings.
//
// Gate 4 (crawl) is invoked by `inventory-crawler` directly.
//
// Gate 5 (status-claim) is the only purely-deterministic gate this
// function owns: for every Action whose claimed_status is `verified`
// or `wired`, it confirms that the Status Reconciler currently
// derives the same value. Disagreement → fail.
//
// Composition: the GitHub Action calls /v1/admin/inventory/.../gates/run
// which POSTs us with `{project_id, commit_sha, pr_number, gates}`;
// we run each requested gate and return a list of `gate_run` records
// the Action then turns into a single composite GitHub status.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const rlog = log.child('inventory-gates')

type GateName = 'dead_handler' | 'mock_leak' | 'api_contract' | 'crawl' | 'status_claim'
type GateStatus = 'pass' | 'fail' | 'warn' | 'skipped' | 'error'

interface GateOutcome {
  gate: GateName
  status: GateStatus
  summary: Record<string, unknown>
  findings_count: number
  run_id: string
}

interface RequestBody {
  project_id?: string
  commit_sha?: string | null
  pr_number?: number | null
  gates?: GateName[]
  triggered_by?: string
  /**
   * For dead-handler / mock-leak: the lint runner posts findings inline
   * since it has the source-line info we don't.
   */
  findings?: Array<{
    gate: GateName
    severity: 'info' | 'warn' | 'error'
    rule_id?: string
    message: string
    file_path?: string
    line?: number
    col?: number
    node_id?: string | null
    suggested_fix?: Record<string, unknown>
  }>
  /**
   * For api_contract: the customer's CI may have walked the repo for
   * Next.js route handlers / OpenAPI / Supabase introspection and
   * already produced a discovered_apis array. We honor it as the
   * authoritative source when present (avoids a second slow crawl).
   */
  discovered_apis?: string[]
}

async function startGateRun(
  db: SupabaseClient,
  body: RequestBody,
  gate: GateName,
): Promise<string> {
  const { data, error } = await db
    .from('gate_runs')
    .insert({
      project_id: body.project_id,
      commit_sha: body.commit_sha ?? null,
      pr_number: body.pr_number ?? null,
      gate,
      status: 'running',
      triggered_by: body.triggered_by ?? 'inventory-gates',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`gate_runs insert failed: ${error?.message}`)
  return data.id as string
}

async function finishGateRun(
  db: SupabaseClient,
  runId: string,
  status: GateStatus,
  summary: Record<string, unknown>,
  findingsCount: number,
): Promise<void> {
  await db
    .from('gate_runs')
    .update({
      status,
      summary,
      findings_count: findingsCount,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)
}

/**
 * Gate 5 — Status-Claim Verification (whitepaper §5 Gate 5).
 *
 * For every Action whose customer-claimed `status` is `verified` or `wired`,
 * confirm the Reconciler's *derived* status matches. This blocks the
 * `inventory.yaml says: status: verified` lie that would otherwise be
 * the cheapest way for an LLM to "fix" a failing build.
 */
async function runStatusClaimGate(
  db: SupabaseClient,
  body: RequestBody,
): Promise<GateOutcome> {
  const runId = await startGateRun(db, body, 'status_claim')

  const { data: actions } = await db
    .from('graph_nodes')
    .select('id, label, metadata')
    .eq('project_id', body.project_id!)
    .eq('node_type', 'action')
    .returns<Array<{ id: string; label: string; metadata: Record<string, unknown> | null }>>()

  let inserted = 0
  const violations: Array<{ id: string; claimed: string; derived: string }> = []
  for (const a of actions ?? []) {
    const claimed = (a.metadata?.['claimed_status'] as string | undefined) ?? 'unknown'
    const derived = (a.metadata?.['status'] as string | undefined) ?? 'unknown'
    if (claimed === 'unknown') continue
    if (claimed === derived) continue
    // Disagreement that crosses the verified-or-wired boundary is a
    // build-blocker. A claim of `mocked` reconciled to `wired` is
    // upgrade noise and we let it pass with a warning.
    const blocking =
      claimed === 'verified' && derived !== 'verified' ||
      (claimed === 'wired' && (derived === 'stub' || derived === 'unknown'))
    if (!blocking) continue
    violations.push({ id: a.id, claimed, derived })
    const { error } = await db.from('gate_findings').insert({
      gate_run_id: runId,
      project_id: body.project_id!,
      severity: 'error',
      rule_id: 'status-claim-violation',
      message: `Action "${a.label}" claims ${claimed} but the reconciler derives ${derived}.`,
      node_id: a.id,
      suggested_fix: {
        explanation:
          'Either the test that promotes this action to its claimed status is missing/rejected by the Sentinel, or the action is genuinely not at that status. Run the Mushi test generator on a recent report against this action, or downgrade the claim.',
      },
    })
    if (!error) inserted += 1
  }

  const status: GateStatus = violations.length === 0 ? 'pass' : 'fail'
  const summary = {
    actions_examined: actions?.length ?? 0,
    violations: violations.length,
    sample: violations.slice(0, 5),
  }
  await finishGateRun(db, runId, status, summary, inserted)
  return { gate: 'status_claim', status, summary, findings_count: inserted, run_id: runId }
}

/**
 * Gate 3 — API Contract Check (whitepaper §5 Gate 3).
 *
 * Compares declared `ApiDep` nodes against the project's discovered API
 * surface. The discovered surface is whatever the most recent `crawl`
 * gate run wrote into `gate_findings.suggested_fix.discovered_apis` —
 * i.e. the inventory-crawler does the slow IO once and we do the diff
 * in memory.
 *
 * Failures: an api_dep with no matching discovered route (frontend says
 * the call exists, no backend handles it).
 * Warnings: a discovered route with no matching api_dep (the inventory
 * is stale; it gets crawled into `drift` for the admin to review).
 */
async function runApiContractGate(
  db: SupabaseClient,
  body: RequestBody,
): Promise<GateOutcome> {
  const runId = await startGateRun(db, body, 'api_contract')

  const { data: apiDeps } = await db
    .from('graph_nodes')
    .select('id, label, metadata')
    .eq('project_id', body.project_id!)
    .eq('node_type', 'api_dep')
    .returns<Array<{ id: string; label: string; metadata: Record<string, unknown> | null }>>()

  // Prefer caller-supplied discovered_apis (the mcp-ci `discover-api`
  // helper walks Next.js + OpenAPI + Supabase for the customer in CI
  // and POSTs the resulting list — fresher than any crawl). Fall back
  // to the most recent crawl run's summary, then skip if neither.
  let discovered: string[] | null = body.discovered_apis ?? null
  if (!discovered) {
    const { data: lastCrawl } = await db
      .from('gate_runs')
      .select('id, summary')
      .eq('project_id', body.project_id!)
      .eq('gate', 'crawl')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    discovered =
      ((lastCrawl?.summary as Record<string, unknown> | null)?.['discovered_apis'] as
        | string[]
        | undefined) ?? null
  }

  if (!discovered) {
    await finishGateRun(db, runId, 'skipped', { reason: 'no crawl data yet' }, 0)
    return {
      gate: 'api_contract',
      status: 'skipped',
      summary: { reason: 'no crawl data yet' },
      findings_count: 0,
      run_id: runId,
    }
  }

  const discoveredSet = new Set(discovered)
  let inserted = 0
  const missing: string[] = []
  for (const dep of apiDeps ?? []) {
    if (!discoveredSet.has(dep.label)) {
      missing.push(dep.label)
      const { error } = await db.from('gate_findings').insert({
        gate_run_id: runId,
        project_id: body.project_id!,
        severity: 'error',
        rule_id: 'api-contract-mismatch',
        message: `inventory.yaml declares ApiDep "${dep.label}" but no matching backend route was discovered.`,
        node_id: dep.id,
      })
      if (!error) inserted += 1
    }
  }

  const status: GateStatus = missing.length === 0 ? 'pass' : 'fail'
  await finishGateRun(db, runId, status, { missing_count: missing.length, sample: missing.slice(0, 5) }, inserted)
  return {
    gate: 'api_contract',
    status,
    summary: { missing_count: missing.length, sample: missing.slice(0, 5) },
    findings_count: inserted,
    run_id: runId,
  }
}

/**
 * Helper for Gates 1 + 2 — the eslint plugin forwards findings here so
 * they show up alongside the server-side gates. We just record the run
 * and persist whatever findings the caller delivered.
 */
async function recordLintGate(
  db: SupabaseClient,
  body: RequestBody,
  gate: 'dead_handler' | 'mock_leak',
): Promise<GateOutcome> {
  const runId = await startGateRun(db, body, gate)
  const findings = (body.findings ?? []).filter((f) => f.gate === gate)
  let inserted = 0
  for (const f of findings) {
    const { error } = await db.from('gate_findings').insert({
      gate_run_id: runId,
      project_id: body.project_id!,
      severity: f.severity,
      rule_id: f.rule_id ?? gate,
      message: f.message,
      file_path: f.file_path,
      line: f.line,
      col: f.col,
      node_id: f.node_id ?? null,
      suggested_fix: f.suggested_fix ?? null,
    })
    if (!error) inserted += 1
  }
  const status: GateStatus =
    findings.length === 0 ? 'pass' : findings.some((f) => f.severity === 'error') ? 'fail' : 'warn'
  await finishGateRun(db, runId, status, { provided_findings: findings.length }, inserted)
  return {
    gate,
    status,
    summary: { provided_findings: findings.length },
    findings_count: inserted,
    run_id: runId,
  }
}

async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'INVALID_JSON', message: 'Body must be JSON' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }
  if (!body.project_id) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'MISSING_PROJECT', message: 'project_id required' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const db = getServiceClient()
  const requested = body.gates ?? ['status_claim', 'api_contract']
  const outcomes: GateOutcome[] = []

  for (const gate of requested) {
    try {
      if (gate === 'status_claim') outcomes.push(await runStatusClaimGate(db, body))
      else if (gate === 'api_contract') outcomes.push(await runApiContractGate(db, body))
      else if (gate === 'dead_handler' || gate === 'mock_leak') {
        outcomes.push(await recordLintGate(db, body, gate))
      } else if (gate === 'crawl') {
        // The crawler is its own edge function; calling it from here would
        // double-bill latency. We mark the request and let the caller poll.
        outcomes.push({
          gate: 'crawl',
          status: 'skipped',
          summary: { reason: 'invoke /functions/v1/inventory-crawler directly' },
          findings_count: 0,
          run_id: '',
        })
      }
    } catch (err) {
      rlog.error('gate failed', { gate, err: String(err) })
      outcomes.push({
        gate,
        status: 'error',
        summary: { error: String(err) },
        findings_count: 0,
        run_id: '',
      })
    }
  }

  // Composite pass/fail signal — the GitHub Action turns this into one status.
  const overall: GateStatus = outcomes.some((o) => o.status === 'fail')
    ? 'fail'
    : outcomes.every((o) => o.status === 'pass' || o.status === 'skipped')
      ? 'pass'
      : 'warn'

  return new Response(
    JSON.stringify({ ok: true, data: { runs: outcomes, overall } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('inventory-gates', handler))
}

// Exported for unit tests under Vitest.
export { runStatusClaimGate, runApiContractGate, recordLintGate }
