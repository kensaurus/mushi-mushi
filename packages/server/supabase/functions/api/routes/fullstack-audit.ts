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
import { adminOrApiKey, keyGrantsAnyScope } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { readAllPages, type PageCount } from '../../_shared/paged-read.ts'
import { resolveSupabasePat, getSupabaseAdvisors, getLogs, listTables } from '../../_shared/supabase-mcp-client.ts'
import { resolveOwnedProject } from '../shared.ts'
import { log } from '../../_shared/logger.ts'
import { runInBackground } from '../../_shared/background.ts'
import { INVENTORY_V2_DOGFOOD_EMAILS, resolvePlanForScope } from '../../_shared/entitlements.ts'
import { parseInventoryYaml } from '../../_shared/inventory.ts'
import { gatesRunRateLimiter, pickCrawlBaseUrl, reconcileRateLimiter } from '../../_shared/inventory-guards.ts'
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
  /** Which stale inventory gates this audit re-ran, and which it skipped and why. */
  gate_refresh: AuditGateRefresh
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
  started_at: string | null
  completed_at: string | null
}

/**
 * Gates the audit re-runs when stale, the same way the Inventory page does:
 * `crawl` through the inventory-crawler (POST …/inventory/:id/reconcile), the
 * rest through inventory-gates (POST …/inventory/:id/gates/run).
 */
const AUDIT_REFRESH_GATES = ['crawl', 'status_claim', 'api_contract', 'orphan_endpoint', 'unknown_call'] as const
/** A gate that started a run within this window is fresh enough. */
const AUDIT_REFRESH_FRESH_MS = 24 * 60 * 60 * 1000

interface AuditGateRefresh {
  /** Gates whose re-run was started by this audit. Results land in gate_runs. */
  triggered: string[]
  /** Gates not re-run, each with the plain-English reason. */
  skipped: Array<{ gate: string; reason: string }>
}

/**
 * Decide which inventory gates this audit re-runs. Freshness is per gate:
 * the newest run of ANY gate (radar and portfolio_radar run daily) used to
 * stand in for all of them, so crawl / status_claim / api_contract never
 * re-ran. A gate with no run in the 7-day read window is stale.
 *
 * @internal Exported for fullstack-audit-gate-refresh.test.ts.
 */
export function planAuditGateRefresh(input: {
  /** null when the gate runs could not be read. */
  latestByGate: ReadonlyMap<string, Pick<GateRunRow, 'started_at' | 'completed_at'>> | null
  /**
   * False for a key without mcp:write or a viewer: the Inventory routes that
   * start these runs need write access (the crawl sends crawler_auth_config).
   */
  canWrite: boolean
  /** 'unknown' when the inventory could not be read. */
  inventory: 'current' | 'none' | 'unknown'
  /** False when the project's plan does not include inventory checks. */
  entitled: boolean
  crawlUrl: { url: string | null; skipped: string[] }
  envReady: boolean
  nowMs: number
}): { crawl: boolean; gates: string[]; skipped: AuditGateRefresh['skipped'] } {
  const skipped: AuditGateRefresh['skipped'] = []
  let crawl = false
  const gates: string[] = []
  for (const gate of AUDIT_REFRESH_GATES) {
    const skip = (reason: string) => skipped.push({ gate, reason })
    if (!input.latestByGate) {
      skip('The gate runs could not be read, so whether this gate is stale is unknown.')
      continue
    }
    const last = input.latestByGate.get(gate)
    const lastAt = last?.started_at ?? last?.completed_at ?? null
    const ageMs = lastAt ? input.nowMs - new Date(lastAt).getTime() : Number.POSITIVE_INFINITY
    if (ageMs < AUDIT_REFRESH_FRESH_MS) {
      skip(`Ran ${Math.max(0, Math.round(ageMs / 3_600_000))} h ago; re-runs once a day.`)
      continue
    }
    if (!input.canWrite) {
      skip('This caller has read-only access (a key without mcp:write, or a viewer), so it cannot start a run.')
      continue
    }
    if (!input.entitled) {
      skip("The project's plan does not include inventory checks.")
      continue
    }
    if (input.inventory === 'none') {
      skip('No current inventory. Ingest inventory.yaml (Inventory → Yaml) first.')
      continue
    }
    if (input.inventory === 'unknown') {
      skip('The inventory could not be read.')
      continue
    }
    if (gate === 'crawl' && !input.crawlUrl.url) {
      const why = input.crawlUrl.skipped.length ? ` (${input.crawlUrl.skipped.join('; ')})` : ''
      skip(`No crawlable URL: set crawler_base_url in project settings${why}.`)
      continue
    }
    if (!input.envReady) {
      skip('The api function has no SUPABASE_URL or service key, so it cannot start the run.')
      continue
    }
    if (gate === 'crawl') crawl = true
    else gates.push(gate)
  }
  return { crawl, gates, skipped }
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
        .select('id, gate, status, findings_count, started_at, completed_at', { count })
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

type InventoryApp = { base_url?: string | null; preview_url?: string | null; staging_url?: string | null }

/** The current inventory's app URLs, mirroring inventory-crawler's loadProject. */
async function readCurrentInventoryApp(
  db: Db,
  projectId: string,
): Promise<{ state: 'current'; app: InventoryApp | null } | { state: 'none' | 'unknown' }> {
  const { data, error } = await db
    .from('inventories')
    .select('id, app:parsed->app')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .maybeSingle()
  if (error) {
    alog.warn('audit: inventory read failed', { projectId, err: error.message })
    return { state: 'unknown' }
  }
  if (!data) return { state: 'none' }
  const app = (data as { app?: InventoryApp | null }).app ?? null
  if (app) return { state: 'current', app }
  // An inventory stored as YAML only: the crawler parses raw_yaml, so do the same.
  const { data: raw } = await db.from('inventories').select('raw_yaml').eq('id', (data as { id: string }).id).maybeSingle()
  const yaml = (raw as { raw_yaml?: string | null } | null)?.raw_yaml
  return { state: 'current', app: yaml ? parseInventoryYaml(yaml).inventory?.app ?? null : null }
}

/**
 * Re-run the stale inventory gates for the audit, with the same guards as the
 * Inventory page's write routes (plan feature, per-project rate limits), and
 * report each skipped gate with its reason. The crawl and the gates start in
 * parallel, so api_contract reads the previous crawl's discovered APIs.
 */
async function refreshStaleInventoryGates(
  db: Db,
  args: {
    projectId: string
    organizationId: string | null
    userEmail: string | null
    canWrite: boolean
    crawlerBaseUrl: string | null
    latestByGate: ReadonlyMap<string, Pick<GateRunRow, 'started_at' | 'completed_at'>> | null
  },
): Promise<AuditGateRefresh> {
  const { projectId } = args
  const [inventory, plan] = await Promise.all([
    readCurrentInventoryApp(db, projectId),
    resolvePlanForScope(db, { organizationId: args.organizationId, projectId }),
  ])
  const email = args.userEmail?.toLowerCase() ?? ''
  const entitled =
    (plan.feature_flags as Record<string, unknown> | undefined)?.inventory_v2 === true ||
    (email !== '' && INVENTORY_V2_DOGFOOD_EMAILS.has(email))
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const decision = planAuditGateRefresh({
    latestByGate: args.latestByGate,
    canWrite: args.canWrite,
    inventory: inventory.state,
    entitled,
    crawlUrl: pickCrawlBaseUrl(args.crawlerBaseUrl, inventory.state === 'current' ? inventory.app : null),
    envReady: Boolean(supabaseUrl && serviceKey),
    nowMs: Date.now(),
  })
  const triggered: string[] = []
  const skipped = [...decision.skipped]

  const invoke = (fn: 'inventory-crawler' | 'inventory-gates', body: Record<string, unknown>) =>
    runInBackground(
      fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ project_id: projectId, triggered_by: 'fullstack-audit', ...body }),
      }).then(async (res) => {
        if (!res.ok) alog.warn('audit: gate re-run refused', { projectId, fn, status: res.status })
        await res.body?.cancel()
      }),
      `fullstack-audit:${fn}`,
    )

  if (decision.crawl) {
    const verdict = reconcileRateLimiter.consume(`${projectId}:reconcile`)
    if (verdict.allowed) {
      invoke('inventory-crawler', {})
      triggered.push('crawl')
    } else {
      skipped.push({ gate: 'crawl', reason: `Rate-limited; retry in ${verdict.retryAfterSeconds} s.` })
    }
  }
  if (decision.gates.length > 0) {
    const verdict = gatesRunRateLimiter.consume(`${projectId}:gates.run`)
    if (verdict.allowed) {
      invoke('inventory-gates', { gates: decision.gates })
      triggered.push(...decision.gates)
    } else {
      for (const gate of decision.gates) {
        skipped.push({ gate, reason: `Rate-limited; retry in ${verdict.retryAfterSeconds} s.` })
      }
    }
  }
  return { triggered, skipped }
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
          'Set the Supabase project ref in Settings → General, then add a scoped, read-only Supabase access token in Settings → AI keys → Supabase to enable backend analysis.',
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

    // ── 4. Re-run stale inventory gates (in the background) ────────────────
    // The scorecard shows the last known state; the re-runs land in gate_runs
    // for the next audit. Each skipped gate is reported with its reason.
    const gateRefresh = await refreshStaleInventoryGates(db, {
      projectId,
      organizationId: (project as { organization_id?: string | null }).organization_id ?? null,
      userEmail: (c.get('userEmail') as string | undefined) ?? null,
      // The same write rule as POST …/inventory/:id/reconcile and /gates/run:
      // a key needs mcp:write, and a viewer may not start runs.
      canWrite:
        (c.get('authMethod') !== 'apiKey' || keyGrantsAnyScope(c.get('apiKeyScopes') ?? [], ['mcp:write'])) &&
        project.organization_role !== 'viewer',
      crawlerBaseUrl: settings?.crawler_base_url ?? null,
      latestByGate: gateRead.ok ? gateRead.latestByGate : null,
    })

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
      gate_refresh: gateRefresh,
    }

    return c.json({ ok: true, data: result })
  })
}

declare const Deno: { env: { get(k: string): string | undefined } }
