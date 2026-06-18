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
import { collectDescendantActionIds } from '../_shared/inventory-story-scope.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const rlog = log.child('inventory-gates')

type GateName =
  | 'dead_handler'
  | 'mock_leak'
  | 'api_contract'
  | 'crawl'
  | 'status_claim'
  | 'orphan_endpoint'
  | 'unknown_call'
  | 'spec_drift'
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
  /**
   * For spec_drift: oasdiff diff output from the mcp-ci Gate 6 Action.
   * Pre-computed by the CI runner; we just persist the findings here.
   */
  spec_diff_findings?: Array<{
    severity: 'info' | 'warn' | 'error'
    rule_id?: string
    message: string
    path?: string
    method?: string
  }>
  /** When set, gates only examine actions under this user_story subtree. */
  story_node_id?: string | null
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

  let scopedActions = actions ?? []
  if (body.story_node_id) {
    const scopedIds = await collectDescendantActionIds(db, body.project_id!, body.story_node_id)
    scopedActions = scopedActions.filter((a) => scopedIds.has(a.id))
  }

  let inserted = 0
  const violations: Array<{ id: string; claimed: string; derived: string }> = []
  for (const a of scopedActions) {
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
    actions_examined: scopedActions.length,
    violations: violations.length,
    sample: violations.slice(0, 5),
    ...(body.story_node_id ? { story_node_id: body.story_node_id } : {}),
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
 * Gate 7 — Orphan Endpoint Detection.
 *
 * Compares the declared + discovered API surface against 30-day SDK-observed
 * network paths. Backend routes that are never called by any frontend session
 * are likely orphaned (dead code, unlinked features, or deprecated endpoints).
 *
 * Source of truth:
 *   - Discovered routes: latest crawl run summary + declared api_dep nodes.
 *   - Observed calls: discovery_observed_inventory (30-day rolling window).
 *
 * Finding severity: warn (not fail) — a backend route may be called from
 * a non-SDK surface (e.g. mobile, webhook). This is a signal, not a blocker.
 */
async function runOrphanEndpointGate(
  db: SupabaseClient,
  body: RequestBody,
): Promise<GateOutcome> {
  const runId = await startGateRun(db, body, 'orphan_endpoint')

  // Collect discovered routes from the latest crawl + declared api_deps.
  const discovered: Set<string> = new Set(body.discovered_apis ?? [])

  const { data: apiDeps } = await db
    .from('graph_nodes')
    .select('label')
    .eq('project_id', body.project_id!)
    .eq('node_type', 'api_dep')
    .returns<Array<{ label: string }>>()

  for (const dep of apiDeps ?? []) discovered.add(dep.label)

  if (discovered.size === 0) {
    await finishGateRun(db, runId, 'skipped', { reason: 'no discovered routes' }, 0)
    return { gate: 'orphan_endpoint', status: 'skipped', summary: { reason: 'no discovered routes' }, findings_count: 0, run_id: runId }
  }

  // Collect observed paths from discovery_observed_inventory (last 30 days).
  const { data: observed } = await db
    .from('discovery_events')
    .select('network_paths')
    .eq('project_id', body.project_id!)
    .gte('observed_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .returns<Array<{ network_paths: string[] }>>()

  const observedSet = new Set<string>()
  for (const row of observed ?? []) {
    for (const p of row.network_paths ?? []) {
      // Normalise: strip query params and trailing slashes for fuzzy match.
      try {
        const url = new URL(p, 'https://placeholder')
        observedSet.add(url.pathname.replace(/\/$/, ''))
      } catch {
        observedSet.add(p.split('?')[0]?.replace(/\/$/, '') ?? p)
      }
    }
  }

  if (observedSet.size === 0) {
    await finishGateRun(db, runId, 'skipped', { reason: 'no SDK discovery data yet' }, 0)
    return { gate: 'orphan_endpoint', status: 'skipped', summary: { reason: 'no SDK discovery data yet' }, findings_count: 0, run_id: runId }
  }

  let inserted = 0
  const orphans: string[] = []
  for (const route of discovered) {
    // Normalise the declared route for comparison.
    const normRoute = route.split('?')[0]?.replace(/\/$/, '') ?? route
    // Check for fuzzy path match (allow for route params like /api/users/:id).
    const isObserved = [...observedSet].some((obs) => {
      if (obs === normRoute) return true
      // Simple param-strip: replace path segments that look like IDs with :param.
      const obsGeneric = obs.replace(/\/[0-9a-f-]{8,}/gi, '/:id').replace(/\/\d+/g, '/:id')
      const routeGeneric = normRoute.replace(/\/:?[\w]+/g, '/:param').replace(/\/\{[\w]+\}/g, '/:param')
      return obsGeneric === routeGeneric || obs.startsWith(normRoute)
    })
    if (!isObserved) {
      orphans.push(route)
      const { error } = await db.from('gate_findings').insert({
        gate_run_id: runId,
        project_id: body.project_id!,
        severity: 'warn',
        rule_id: 'orphan-endpoint',
        message: `Backend route "${route}" has no observed frontend calls in the past 30 days. It may be an orphaned feature, dead code, or only called from a non-SDK surface.`,
        suggested_fix: {
          explanation:
            'If this endpoint is intentional (webhook, mobile-only, admin-only), add it to inventory.yaml with a note. If it is dead code, consider removing it.',
          route,
        },
      })
      if (!error) inserted++
    }
  }

  const status: GateStatus = orphans.length === 0 ? 'pass' : 'warn'
  await finishGateRun(db, runId, status, {
    total_routes: discovered.size,
    observed_routes: discovered.size - orphans.length,
    orphan_count: orphans.length,
    sample: orphans.slice(0, 5),
  }, inserted)

  return {
    gate: 'orphan_endpoint',
    status,
    summary: { total_routes: discovered.size, orphan_count: orphans.length, sample: orphans.slice(0, 5) },
    findings_count: inserted,
    run_id: runId,
  }
}

/**
 * Gate 8 — Unknown Call Detection.
 *
 * The inverse of Gate 7: SDK-observed network calls that match neither a
 * declared api_dep nor a discovered backend route. This catches the classic
 * "frontend calling an endpoint that was never deployed" bug class.
 *
 * Finding severity: error when the path looks like a new/undeployed API
 * (e.g. /api/v2/*), warn for paths that may be third-party services.
 */
async function runUnknownCallGate(
  db: SupabaseClient,
  body: RequestBody,
): Promise<GateOutcome> {
  const runId = await startGateRun(db, body, 'unknown_call')

  // Known-good: declared api_deps + discovered routes from latest crawl.
  const known = new Set<string>(body.discovered_apis ?? [])
  const { data: apiDeps } = await db
    .from('graph_nodes')
    .select('label')
    .eq('project_id', body.project_id!)
    .eq('node_type', 'api_dep')
    .returns<Array<{ label: string }>>()
  for (const dep of apiDeps ?? []) known.add(dep.label)

  // Get project base URL to filter out third-party calls.
  const { data: settings } = await db
    .from('project_settings')
    .select('crawler_base_url')
    .eq('project_id', body.project_id!)
    .maybeSingle()
  const baseUrl = (settings as { crawler_base_url?: string } | null)?.crawler_base_url ?? ''

  // Observed network paths from discovery events in the last 30 days.
  const { data: observed } = await db
    .from('discovery_events')
    .select('network_paths')
    .eq('project_id', body.project_id!)
    .gte('observed_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .returns<Array<{ network_paths: string[] }>>()

  const allObserved = new Set<string>()
  for (const row of observed ?? []) {
    for (const p of row.network_paths ?? []) {
      allObserved.add(p)
    }
  }

  if (allObserved.size === 0 || known.size === 0) {
    await finishGateRun(db, runId, 'skipped', { reason: 'insufficient data for comparison' }, 0)
    return { gate: 'unknown_call', status: 'skipped', summary: { reason: 'insufficient data' }, findings_count: 0, run_id: runId }
  }

  let inserted = 0
  const unknowns: string[] = []

  for (const path of allObserved) {
    // Skip third-party calls (different origin from base URL).
    if (baseUrl) {
      try {
        const pathUrl = new URL(path, 'https://placeholder')
        const base = new URL(baseUrl)
        if (!path.startsWith('/') && pathUrl.hostname !== base.hostname) continue
      } catch { /* keep */ }
    }

    // Normalise for comparison (same logic as Gate 7).
    const normPath = path.split('?')[0]?.replace(/\/$/, '') ?? path
    const isKnown = [...known].some((k) => {
      const normK = k.split('?')[0]?.replace(/\/$/, '') ?? k
      return normK === normPath || normPath.startsWith(normK) || normK.startsWith(normPath)
    })

    if (!isKnown) {
      unknowns.push(path)
      const isLikelyApi = /\/api\//i.test(path) || /\/v\d+\//i.test(path) || /\/rpc\//i.test(path)
      const { error } = await db.from('gate_findings').insert({
        gate_run_id: runId,
        project_id: body.project_id!,
        severity: isLikelyApi ? 'error' : 'warn',
        rule_id: 'unknown-call',
        message: `SDK-observed network path "${path}" has no matching backend declaration or crawled route. This may indicate a 404, a missing migration, or an undeclared API endpoint.`,
        suggested_fix: {
          explanation: isLikelyApi
            ? 'This looks like an API call. Check if the backend endpoint is deployed and declared in inventory.yaml as an ApiDep.'
            : 'This may be a third-party service call. If it belongs to your API, add it to inventory.yaml.',
          path,
        },
      })
      if (!error) inserted++
    }
  }

  const hasFails = unknowns.some((u) => /\/api\//i.test(u) || /\/v\d+\//i.test(u))
  const status: GateStatus = unknowns.length === 0 ? 'pass' : hasFails ? 'fail' : 'warn'
  await finishGateRun(db, runId, status, {
    observed_paths: allObserved.size,
    known_paths: known.size,
    unknown_count: unknowns.length,
    sample: unknowns.slice(0, 5),
  }, inserted)

  return {
    gate: 'unknown_call',
    status,
    summary: { observed_paths: allObserved.size, unknown_count: unknowns.length, sample: unknowns.slice(0, 5) },
    findings_count: inserted,
    run_id: runId,
  }
}

/**
 * Gate 6 — OpenAPI Spec Drift (CI-side, server-side recording).
 *
 * The mpc-ci `spec-drift` command runs oasdiff locally in the CI job,
 * then POSTs the findings here via spec_diff_findings in the request body.
 * We persist the run and findings exactly as the caller delivers them.
 */
async function recordSpecDriftGate(
  db: SupabaseClient,
  body: RequestBody,
): Promise<GateOutcome> {
  const runId = await startGateRun(db, body, 'spec_drift')
  const findings = body.spec_diff_findings ?? []
  let inserted = 0
  for (const f of findings) {
    const { error } = await db.from('gate_findings').insert({
      gate_run_id: runId,
      project_id: body.project_id!,
      severity: f.severity,
      rule_id: f.rule_id ?? 'spec-drift',
      message: f.message,
      file_path: f.path ?? null,
      suggested_fix: f.method
        ? { method: f.method, path: f.path }
        : null,
    })
    if (!error) inserted++
  }
  const status: GateStatus =
    findings.length === 0 ? 'pass'
    : findings.some((f) => f.severity === 'error') ? 'fail'
    : 'warn'
  await finishGateRun(db, runId, status, { provided_findings: findings.length }, inserted)
  return { gate: 'spec_drift', status, summary: { provided_findings: findings.length }, findings_count: inserted, run_id: runId }
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
  const requested = body.gates ?? ['status_claim', 'api_contract', 'orphan_endpoint', 'unknown_call']
  const outcomes: GateOutcome[] = []

  for (const gate of requested) {
    try {
      if (gate === 'status_claim') outcomes.push(await runStatusClaimGate(db, body))
      else if (gate === 'api_contract') outcomes.push(await runApiContractGate(db, body))
      else if (gate === 'orphan_endpoint') outcomes.push(await runOrphanEndpointGate(db, body))
      else if (gate === 'unknown_call') outcomes.push(await runUnknownCallGate(db, body))
      else if (gate === 'spec_drift') outcomes.push(await recordSpecDriftGate(db, body))
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
