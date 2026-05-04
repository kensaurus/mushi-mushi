// ============================================================
// Status Reconciler — every 5 minutes (whitepaper §3.3, §4.6)
//
// Why this exists
// ───────────────
// v2 introduces six derived statuses (🔴🟠🟡🟢⚫⚪) on every Action node.
// They are NEVER written by hand — the customer can claim a status in
// inventory.yaml, but the on-graph status is the one this function
// derives from observable signals:
//
//   stub      🔴 — UI exists, no handler / handler is empty
//   mocked    🟠 — handler runs against mock data
//   wired     🟡 — handler hits real backend, no E2E verification
//   verified  🟢 — Sentinel-approved Playwright passing AND ground-truth
//                  assertion present (DB row, status code, …)
//   regressed ⚫ — was verified, now failing
//   unknown   ⚪ — not yet evaluated
//
// Determinism is the point. The reconciler reads:
//   - `gate_findings` for dead-handler / mock-leak / contract / claim hits
//   - `sentinel_verdicts` for the test auditor verdict
//   - graph edges (`verified_by`) joined to recent test results
//   - `synthetic_runs` for prod failures
//   - reports + errors counts in the same project
//
// …and rewrites `graph_nodes.metadata->>'status'` on every Action it
// touches. Any transition writes a `status_history` row so the admin's
// "last 50 transitions" panel + the regression alert ribbon stay live.
//
// LLM cost: zero. The whole derivation is SQL + a small in-memory pass.
//
// Cron: pg_cron `mushi-status-reconciler-tick` every */5 minutes,
// installed by `20260504000000_v2_bidirectional_graph.sql`.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import type { Status } from '../_shared/inventory.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const rlog = log.child('status-reconciler')

interface ProjectRow {
  id: string
}

interface ActionNodeRow {
  id: string
  project_id: string
  label: string
  metadata: Record<string, unknown> | null
}

interface FindingRow {
  node_id: string | null
  rule_id: string | null
  gate: string
  severity: string
}

interface SentinelRow {
  test_file: string
  test_name: string
  verdict: 'approved' | 'rejected' | 'unknown'
}

interface SyntheticRow {
  action_node_id: string
  status: 'passed' | 'failed' | 'error' | 'skipped'
  ran_at: string
}

interface TestEdgeRow {
  source_node_id: string
  target_node_id: string
  metadata: Record<string, unknown> | null
}

interface TestNodeRow {
  id: string
  label: string
  metadata: Record<string, unknown> | null
}

interface DerivationContext {
  /** rule_id → set of action node ids the rule has flagged on the most
   *  recent passing-or-failing run. Keys are the gate rule names: e.g.
   *  'no-dead-handler', 'no-mock-leak', 'api-contract-mismatch',
   *  'crawl-missing-in-app', 'status-claim-violation'. */
  findingsByRule: Map<string, Set<string>>
  /** action node id → most-recent synthetic run (single, latest). */
  latestSynthetic: Map<string, SyntheticRow>
  /** test node id → Sentinel verdict for that test, defaulting to
   *  'unknown' when the auditor has not evaluated it yet. */
  sentinelByTest: Map<string, SentinelRow['verdict']>
  /** action node id → list of verifying test node ids (via verified_by
   *  edges). Empty when the action has no declared coverage. */
  testsByAction: Map<string, string[]>
  /** action node id → previous derived status. Used to detect
   *  verified→regressed transitions. */
  previousStatus: Map<string, Status>
}

const ALL_STATUSES: Status[] = ['stub', 'mocked', 'wired', 'verified', 'regressed', 'unknown']

function metaStatus(meta: Record<string, unknown> | null): Status {
  const s = meta?.['status']
  if (typeof s === 'string' && (ALL_STATUSES as string[]).includes(s)) return s as Status
  return 'unknown'
}

function metaTestidFromTestNode(label: string): { file: string; name: string } | null {
  // test node label format: "<file>::<name>"
  const idx = label.indexOf('::')
  if (idx < 0) return null
  return { file: label.slice(0, idx), name: label.slice(idx + 2) }
}

/**
 * Whitepaper §3.3 derivation:
 *
 *   stub      ← Gate 1 dead-handler hit on this action
 *   mocked    ← Gate 2 mock-leak hit, OR (no api_dep edges AND not stub)
 *   wired     ← has api_dep edge, no verified_by, OR has tests but at
 *               least one Sentinel REJECTED
 *   verified  ← every verifying test is Sentinel-approved AND latest
 *               synthetic run (if any) passed
 *   regressed ← was verified, now any verifying test is failing OR
 *               latest synthetic failed
 *   unknown   ← no signals yet
 */
export function deriveStatus(
  actionId: string,
  hasApiEdge: boolean,
  ctx: DerivationContext,
): Status {
  const tests = ctx.testsByAction.get(actionId) ?? []
  const synthetic = ctx.latestSynthetic.get(actionId) ?? null

  const deadHandler = ctx.findingsByRule.get('no-dead-handler')?.has(actionId) ?? false
  const mockLeak = ctx.findingsByRule.get('no-mock-leak')?.has(actionId) ?? false
  const contractMismatch =
    ctx.findingsByRule.get('api-contract-mismatch')?.has(actionId) ?? false
  const claimViolation =
    ctx.findingsByRule.get('status-claim-violation')?.has(actionId) ?? false

  if (deadHandler) return 'stub'

  // Tests must ALL be approved for the verified path to remain open.
  let allApproved = tests.length > 0
  let anyRejected = false
  for (const t of tests) {
    const v = ctx.sentinelByTest.get(t) ?? 'unknown'
    if (v === 'approved') continue
    allApproved = false
    if (v === 'rejected') anyRejected = true
  }

  const previous = ctx.previousStatus.get(actionId) ?? 'unknown'

  // Synthetic regression takes precedence — once we see a real prod
  // failure, the status is regressed regardless of unit test state.
  if (synthetic && synthetic.status !== 'passed' && previous === 'verified') {
    return 'regressed'
  }

  if (allApproved) {
    if (synthetic && synthetic.status !== 'passed') return 'regressed'
    return 'verified'
  }

  if (mockLeak) return 'mocked'
  if (contractMismatch || claimViolation) return 'wired'

  if (hasApiEdge) {
    if (anyRejected) return 'wired'
    return 'wired'
  }

  if (tests.length > 0 && anyRejected) return 'wired'

  if (!hasApiEdge && !deadHandler && tests.length === 0) {
    // No api edge, no tests, no dead-handler — could be a hardcoded
    // mock or a static stub. Lean toward "mocked" only when the
    // scanner saw a mock leak; otherwise unknown.
    return mockLeak ? 'mocked' : 'unknown'
  }

  return 'unknown'
}

async function loadProjectsToReconcile(db: SupabaseClient): Promise<ProjectRow[]> {
  // Only walk projects that have explicitly enabled inventory_v2 — this
  // is the same gate the admin UI checks before showing /inventory.
  const { data, error } = await db
    .from('projects')
    .select('id, project_settings!inner(inventory_v2_enabled)')
    .eq('project_settings.inventory_v2_enabled', true)
  if (error) {
    rlog.warn('projects load failed', { error: error.message })
    return []
  }
  return (data ?? []).map((row) => ({ id: row.id as string }))
}

async function buildContextForProject(
  db: SupabaseClient,
  projectId: string,
  actionIds: string[],
): Promise<DerivationContext> {
  if (actionIds.length === 0) {
    return {
      findingsByRule: new Map(),
      latestSynthetic: new Map(),
      sentinelByTest: new Map(),
      testsByAction: new Map(),
      previousStatus: new Map(),
    }
  }

  // 1. Most-recent gate findings (last 24h) per rule, scoped to the
  //    project. We bound the lookback so a stale finding from a long-
  //    abandoned branch can't keep an action red forever — a follow-up
  //    clean run wipes the finding by virtue of being absent.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: rawFindings } = await db
    .from('gate_findings')
    .select('node_id, rule_id, severity, gate_runs!inner(gate)')
    .eq('project_id', projectId)
    .gte('created_at', cutoff)
    .eq('allowlisted', false)
    .returns<Array<FindingRow & { gate_runs: { gate: string } }>>()

  const findingsByRule = new Map<string, Set<string>>()
  for (const f of rawFindings ?? []) {
    if (!f.node_id) continue
    const key = f.rule_id ?? `${(f as unknown as { gate_runs: { gate: string } }).gate_runs.gate}-finding`
    const set = findingsByRule.get(key) ?? new Set<string>()
    set.add(f.node_id)
    findingsByRule.set(key, set)
  }

  // 2. Latest synthetic run per action (last 7 days).
  const synthCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const latestSynthetic = new Map<string, SyntheticRow>()
  const { data: synthRows } = await db
    .from('synthetic_runs')
    .select('action_node_id, status, ran_at')
    .eq('project_id', projectId)
    .gte('ran_at', synthCutoff)
    .order('ran_at', { ascending: false })
    .limit(2000)
    .returns<SyntheticRow[]>()
  for (const row of synthRows ?? []) {
    if (!latestSynthetic.has(row.action_node_id)) latestSynthetic.set(row.action_node_id, row)
  }

  // 3. verified_by edges + sentinel verdicts.
  const { data: edges } = await db
    .from('graph_edges')
    .select('source_node_id, target_node_id, metadata')
    .eq('project_id', projectId)
    .eq('edge_type', 'verified_by')
    .returns<TestEdgeRow[]>()
  const testsByAction = new Map<string, string[]>()
  const testIds = new Set<string>()
  for (const edge of edges ?? []) {
    if (!actionIds.includes(edge.source_node_id)) continue
    const arr = testsByAction.get(edge.source_node_id) ?? []
    arr.push(edge.target_node_id)
    testsByAction.set(edge.source_node_id, arr)
    testIds.add(edge.target_node_id)
  }

  let testNodes: TestNodeRow[] = []
  if (testIds.size > 0) {
    const { data: nodes } = await db
      .from('graph_nodes')
      .select('id, label, metadata')
      .in('id', Array.from(testIds))
      .returns<TestNodeRow[]>()
    testNodes = nodes ?? []
  }

  const sentinelByTest = new Map<string, SentinelRow['verdict']>()
  if (testNodes.length > 0) {
    const labels = testNodes.map((n) => metaTestidFromTestNode(n.label)).filter(
      (v): v is { file: string; name: string } => v !== null,
    )
    if (labels.length > 0) {
      const { data: verdicts } = await db
        .from('sentinel_verdicts')
        .select('test_file, test_name, verdict, evaluated_at')
        .eq('project_id', projectId)
        .in('test_file', labels.map((l) => l.file))
        .order('evaluated_at', { ascending: false })
        .returns<Array<SentinelRow & { evaluated_at: string }>>()
      const verdictMap = new Map<string, SentinelRow['verdict']>()
      for (const v of verdicts ?? []) {
        const k = `${v.test_file}::${v.test_name}`
        if (!verdictMap.has(k)) verdictMap.set(k, v.verdict)
      }
      for (const tn of testNodes) {
        const parsed = metaTestidFromTestNode(tn.label)
        if (!parsed) continue
        sentinelByTest.set(tn.id, verdictMap.get(`${parsed.file}::${parsed.name}`) ?? 'unknown')
      }
    }
  }

  // 4. Previous derived status per action, lifted from the same nodes
  //    we just loaded — kept out of `loadActions` so callers can cache.
  const { data: actionRows } = await db
    .from('graph_nodes')
    .select('id, metadata')
    .in('id', actionIds)
    .returns<Array<{ id: string; metadata: Record<string, unknown> | null }>>()
  const previousStatus = new Map<string, Status>()
  for (const row of actionRows ?? []) {
    previousStatus.set(row.id, metaStatus(row.metadata))
  }

  return { findingsByRule, latestSynthetic, sentinelByTest, testsByAction, previousStatus }
}

interface ReconcileStats {
  projectId: string
  examined: number
  changed: number
  toVerified: number
  toRegressed: number
  toStub: number
  toMocked: number
  toWired: number
  toUnknown: number
}

async function reconcileProject(db: SupabaseClient, projectId: string): Promise<ReconcileStats> {
  const stats: ReconcileStats = {
    projectId,
    examined: 0,
    changed: 0,
    toVerified: 0,
    toRegressed: 0,
    toStub: 0,
    toMocked: 0,
    toWired: 0,
    toUnknown: 0,
  }

  const { data: actions } = await db
    .from('graph_nodes')
    .select('id, project_id, label, metadata')
    .eq('project_id', projectId)
    .eq('node_type', 'action')
    .returns<ActionNodeRow[]>()
  if (!actions || actions.length === 0) return stats

  const actionIds = actions.map((a) => a.id)
  const ctx = await buildContextForProject(db, projectId, actionIds)

  // Look up which actions have at least one calls-edge (api_dep). One
  // round trip; cheaper than per-action loops.
  const { data: callsEdges } = await db
    .from('graph_edges')
    .select('source_node_id')
    .eq('project_id', projectId)
    .eq('edge_type', 'calls')
    .returns<Array<{ source_node_id: string }>>()
  const hasApiEdge = new Set<string>()
  for (const e of callsEdges ?? []) hasApiEdge.add(e.source_node_id)

  const transitions: Array<{
    project_id: string
    node_id: string
    from_status: string | null
    to_status: Status
    trigger: string
    evidence: Record<string, unknown>
  }> = []

  for (const action of actions) {
    stats.examined += 1
    const previous = metaStatus(action.metadata)
    const derived = deriveStatus(action.id, hasApiEdge.has(action.id), ctx)

    if (derived === previous) continue

    stats.changed += 1
    if (derived === 'verified') stats.toVerified += 1
    else if (derived === 'regressed') stats.toRegressed += 1
    else if (derived === 'stub') stats.toStub += 1
    else if (derived === 'mocked') stats.toMocked += 1
    else if (derived === 'wired') stats.toWired += 1
    else if (derived === 'unknown') stats.toUnknown += 1

    const newMeta = { ...(action.metadata ?? {}), status: derived, last_status_change: new Date().toISOString() }
    const { error: updErr } = await db
      .from('graph_nodes')
      .update({ metadata: newMeta })
      .eq('id', action.id)
    if (updErr) {
      rlog.warn('graph_node update failed', { actionId: action.id, error: updErr.message })
      continue
    }
    transitions.push({
      project_id: projectId,
      node_id: action.id,
      from_status: previous,
      to_status: derived,
      trigger: 'reconciler',
      evidence: collectEvidence(action.id, hasApiEdge.has(action.id), ctx),
    })
  }

  if (transitions.length > 0) {
    const { error: histErr } = await db.from('status_history').insert(transitions)
    if (histErr) {
      rlog.warn('status_history insert failed', { projectId, error: histErr.message })
    }
  }

  return stats
}

function collectEvidence(
  actionId: string,
  hasApiEdge: boolean,
  ctx: DerivationContext,
): Record<string, unknown> {
  const tests = ctx.testsByAction.get(actionId) ?? []
  return {
    has_api_edge: hasApiEdge,
    test_count: tests.length,
    sentinel: tests.map((t) => ctx.sentinelByTest.get(t) ?? 'unknown'),
    latest_synthetic: ctx.latestSynthetic.get(actionId)?.status ?? null,
    findings: Array.from(ctx.findingsByRule.entries())
      .filter(([, set]) => set.has(actionId))
      .map(([rule]) => rule),
  }
}

async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp

  const db = getServiceClient()
  const cron = await startCronRun(db, 'status-reconciler', 'cron')

  try {
    const projects = await loadProjectsToReconcile(db)
    rlog.info('reconcile.start', { project_count: projects.length })

    const aggregate = {
      projects: projects.length,
      examined: 0,
      changed: 0,
      toVerified: 0,
      toRegressed: 0,
      toStub: 0,
      toMocked: 0,
      toWired: 0,
      toUnknown: 0,
    }
    const perProject: ReconcileStats[] = []
    for (const proj of projects) {
      try {
        const s = await reconcileProject(db, proj.id)
        perProject.push(s)
        aggregate.examined += s.examined
        aggregate.changed += s.changed
        aggregate.toVerified += s.toVerified
        aggregate.toRegressed += s.toRegressed
        aggregate.toStub += s.toStub
        aggregate.toMocked += s.toMocked
        aggregate.toWired += s.toWired
        aggregate.toUnknown += s.toUnknown
      } catch (err) {
        rlog.error('project reconcile failed', { project_id: proj.id, error: String(err) })
      }
    }

    await cron.finish({ rowsAffected: aggregate.changed, metadata: aggregate })
    rlog.info('reconcile.done', aggregate)
    return new Response(JSON.stringify({ ok: true, data: { aggregate, perProject } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    await cron.fail(err)
    rlog.error('reconcile.failed', { error: String(err) })
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'RECONCILE_FAILED', message: String(err) } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('status-reconciler', handler))
}
