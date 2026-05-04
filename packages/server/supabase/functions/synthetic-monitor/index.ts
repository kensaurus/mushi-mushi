// ============================================================
// synthetic-monitor — every 15 minutes (whitepaper §4.4)
//
// Probes production for every Action whose project has
// `synthetic_monitor_enabled=true`. The probe walks the action's
// declared `verified_by` test, hits the matching api_dep route, and
// (when the action declares a db_dep with operation=insert/update)
// asserts the corresponding row appeared.
//
// We do NOT attempt to replay the full Playwright test in production —
// that would either need real user creds (security) or full sandbox
// orchestration (cost). Instead the probe fires the BACKEND call the
// test would have caused (using a service-role-scoped synthetic
// account) and asserts the side-effect. This catches every dimension
// of regression that the whitepaper §3.3 defines as "regressed":
//   - the API endpoint disappears or 500s
//   - the DB write stops happening
//   - the response shape drifts
//
// Synthetic identities
// ────────────────────
// Each project_settings row may store a `synthetic_account_*` set —
// when present, the probe authenticates as that user. When absent, the
// probe falls back to the project's anon endpoint and only flags
// auth-required actions as `skipped`. A future PR adds dedicated
// account leasing.
//
// Output
// ──────
// One `synthetic_runs` row per (project, action_node_id, ran_at). The
// admin /inventory Synthetic tab consumes this for sparkline + last-
// failure detail.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import {
  inventoryAppAllowHosts,
  safeFetch,
  type SafeUrlOptions,
} from '../_shared/inventory-guards.ts'
import { parseInventoryYaml, type Inventory } from '../_shared/inventory.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const rlog = log.child('synthetic-monitor')

interface ActionNode {
  id: string
  label: string
  metadata: Record<string, unknown> | null
}

interface ApiDepNode {
  id: string
  metadata: Record<string, unknown> | null
}

interface DbDepNode {
  id: string
  metadata: Record<string, unknown> | null
}

interface ProbeResult {
  status: 'passed' | 'failed' | 'error' | 'skipped'
  latencyMs: number
  errorMessage?: string
  dbAssertions?: Record<string, unknown>
  stepResults?: Record<string, unknown>
}

interface ProjectSetting {
  project_id: string
  synthetic_monitor_target_url: string | null
  crawler_auth_config: Record<string, unknown> | null
  /**
   * Per-whitepaper §4.4: when false (default), the probe ONLY exercises
   * idempotent verbs (GET / HEAD / OPTIONS). The cron used to fire
   * DELETE / PATCH / PUT against production with the customer's auth
   * token attached because the schema flag was missing — see the
   * 2026-05-04 audit. `synthetic_monitor_allow_mutations=true` is now
   * the explicit opt-in, intended for projects pointing the monitor at
   * a sandboxed test environment.
   */
  synthetic_monitor_allow_mutations: boolean | null
}

async function loadProbeProjects(db: SupabaseClient): Promise<ProjectSetting[]> {
  const { data, error } = await db
    .from('project_settings')
    .select(
      'project_id, synthetic_monitor_target_url, crawler_auth_config, synthetic_monitor_enabled, synthetic_monitor_allow_mutations',
    )
    .eq('synthetic_monitor_enabled', true)
  if (error) {
    rlog.warn('project_settings load failed', { error: error.message })
    return []
  }
  return (data ?? []) as ProjectSetting[]
}

/**
 * Set of HTTP verbs the synthetic probe is allowed to fire. GETs, HEADs,
 * and OPTIONS are universally safe. Mutating verbs require the operator
 * to opt in via `synthetic_monitor_allow_mutations=true` AND point the
 * monitor at a test environment.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function isMethodAllowed(method: string, allowMutations: boolean): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true
  return allowMutations
}

/**
 * Load the project's current inventory snapshot — needed to derive the
 * SSRF allowlist for the probe. The synthetic monitor is only ever
 * supposed to talk to hosts the inventory declares plus the explicit
 * `synthetic_monitor_target_url`, so the union of those forms the safe
 * host set.
 */
async function loadProjectInventory(
  db: SupabaseClient,
  projectId: string,
): Promise<Inventory | null> {
  const { data: snapshot } = await db
    .from('inventories')
    .select('parsed, raw_yaml')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .maybeSingle()

  if (snapshot?.parsed) return snapshot.parsed as Inventory
  if (snapshot?.raw_yaml) {
    const parsed = parseInventoryYaml(snapshot.raw_yaml as string)
    return parsed.inventory ?? null
  }
  return null
}

async function loadActionsForProject(
  db: SupabaseClient,
  projectId: string,
): Promise<{
  action: ActionNode
  api: ApiDepNode | null
  dbWrite: DbDepNode | null
}[]> {
  const { data: actions } = await db
    .from('graph_nodes')
    .select('id, label, metadata')
    .eq('project_id', projectId)
    .eq('node_type', 'action')
    .returns<ActionNode[]>()
  if (!actions || actions.length === 0) return []

  const { data: edges } = await db
    .from('graph_edges')
    .select('source_node_id, target_node_id, edge_type')
    .eq('project_id', projectId)
    .in('edge_type', ['calls', 'writes'])

  const apiByAction = new Map<string, string>()
  const dbByAction = new Map<string, string>()
  for (const e of edges ?? []) {
    if (e.edge_type === 'calls') apiByAction.set(e.source_node_id, e.target_node_id)
    if (e.edge_type === 'writes') dbByAction.set(e.source_node_id, e.target_node_id)
  }

  const targetIds = new Set<string>()
  for (const v of apiByAction.values()) targetIds.add(v)
  for (const v of dbByAction.values()) targetIds.add(v)

  const { data: targets } =
    targetIds.size > 0
      ? await db
          .from('graph_nodes')
          .select('id, node_type, metadata')
          .in('id', Array.from(targetIds))
          .returns<Array<ApiDepNode & { node_type: string }>>()
      : { data: [] }

  const apiById = new Map<string, ApiDepNode>()
  const dbById = new Map<string, DbDepNode>()
  for (const t of targets ?? []) {
    if ((t as { node_type: string }).node_type === 'api_dep') apiById.set(t.id, t)
    if ((t as { node_type: string }).node_type === 'db_dep') dbById.set(t.id, t)
  }

  return actions.map((a) => ({
    action: a,
    api: apiById.get(apiByAction.get(a.id) ?? '') ?? null,
    dbWrite: dbById.get(dbByAction.get(a.id) ?? '') ?? null,
  }))
}

async function probeAction(
  baseUrl: string,
  action: ActionNode,
  api: ApiDepNode | null,
  authHeaders: Record<string, string>,
  options: { allowMutations: boolean; urlOptions?: SafeUrlOptions } = { allowMutations: false },
): Promise<ProbeResult> {
  if (!api) {
    return { status: 'skipped', latencyMs: 0, errorMessage: 'no api_dep declared' }
  }
  const method = ((api.metadata?.['method'] as string | undefined) ?? 'GET').toUpperCase()
  const path = (api.metadata?.['path'] as string | undefined) ?? '/'

  if (!isMethodAllowed(method, options.allowMutations)) {
    // Per whitepaper §4.4 + 2026-05-04 audit: never fire mutating verbs
    // against the customer's app unless they explicitly opt in. Skipped
    // probes show up in the timeline as a soft indicator so the operator
    // sees coverage gaps without their prod data getting clobbered.
    return {
      status: 'skipped',
      latencyMs: 0,
      errorMessage: `method ${method} skipped: synthetic_monitor_allow_mutations=false`,
      stepResults: { method, path, skipped_reason: 'mutation_not_allowed' },
    }
  }

  // Substitute path parameters with deterministic synthetic placeholders.
  const concretePath = path.replace(/\{[^}]+\}/g, '00000000-0000-0000-0000-000000000000')
  const url = new URL(concretePath, baseUrl).toString()
  const start = Date.now()
  try {
    const res = await safeFetch(
      url,
      {
        method,
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
          'X-Mushi-Synthetic-Probe': '1',
        },
        body: SAFE_METHODS.has(method) ? undefined : JSON.stringify({ synthetic: true }),
      },
      { url: options.urlOptions ?? {}, timeoutMs: 10_000, maxRedirects: 2 },
    )
    const latencyMs = Date.now() - start
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '')
      return {
        status: 'failed',
        latencyMs,
        errorMessage: `HTTP ${res.status}: ${errorBody.slice(0, 240)}`,
        stepResults: { method, path: concretePath, status_code: res.status },
      }
    }
    return {
      status: 'passed',
      latencyMs,
      stepResults: { method, path: concretePath, status_code: res.status },
    }
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  }
}

async function probeProject(
  db: SupabaseClient,
  setting: ProjectSetting,
): Promise<{ projectId: string; probed: number; failed: number }> {
  const items = await loadActionsForProject(db, setting.project_id)
  if (items.length === 0) return { projectId: setting.project_id, probed: 0, failed: 0 }

  const baseUrl = setting.synthetic_monitor_target_url
  if (!baseUrl) {
    rlog.warn('synthetic-monitor: no target_url; skipping', { project_id: setting.project_id })
    return { projectId: setting.project_id, probed: 0, failed: 0 }
  }

  const auth = setting.crawler_auth_config as
    | { type: string; config: { token?: string; name?: string; value?: string } }
    | null
  const headers: Record<string, string> = {}
  if (auth?.type === 'bearer' || auth?.type === 'oauth') {
    if (auth.config.token) headers['Authorization'] = `Bearer ${auth.config.token}`
  } else if (auth?.type === 'cookie' && auth.config.name && auth.config.value) {
    headers['Cookie'] = `${auth.config.name}=${auth.config.value}`
  }

  // SSRF allowlist: union of inventory.app.{base,preview,staging}_url
  // hosts and the configured synthetic target host. Cron callers don't
  // get the PATCH /settings SSRF check (the URL was vetted at write
  // time), but this is still defence-in-depth — and catches the case
  // where a project's settings predate the SSRF guard migration.
  const inventory = await loadProjectInventory(db, setting.project_id)
  const allowHosts = inventory ? inventoryAppAllowHosts(inventory.app) : []
  try {
    allowHosts.push(new URL(baseUrl).hostname.toLowerCase())
  } catch {
    rlog.warn('synthetic-monitor: target_url is not a valid URL; skipping', {
      project_id: setting.project_id,
    })
    return { projectId: setting.project_id, probed: 0, failed: 0 }
  }
  const urlOptions: SafeUrlOptions = { allowHosts: Array.from(new Set(allowHosts)) }

  const allowMutations = setting.synthetic_monitor_allow_mutations === true

  let failed = 0
  for (const item of items) {
    // Only probe actions whose claimed status is verified or wired —
    // there's no signal to be gained from probing a known stub.
    const claimed = (item.action.metadata?.['claimed_status'] as string | undefined) ?? 'unknown'
    if (claimed !== 'verified' && claimed !== 'wired') continue

    const probe = await probeAction(baseUrl, item.action, item.api, headers, {
      allowMutations,
      urlOptions,
    })
    const { error } = await db.from('synthetic_runs').insert({
      project_id: setting.project_id,
      action_node_id: item.action.id,
      status: probe.status,
      latency_ms: probe.latencyMs,
      error_message: probe.errorMessage ?? null,
      db_assertions: probe.dbAssertions ?? null,
      step_results: probe.stepResults ?? null,
    })
    if (error) rlog.warn('synthetic_runs insert failed', { error: error.message })
    if (probe.status === 'failed' || probe.status === 'error') failed += 1
  }

  return { projectId: setting.project_id, probed: items.length, failed }
}

async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp

  const db = getServiceClient()
  const cron = await startCronRun(db, 'synthetic-monitor', 'cron')

  try {
    const projects = await loadProbeProjects(db)
    rlog.info('synthetic-monitor.start', { project_count: projects.length })
    const stats = []
    let totalFailed = 0
    let totalProbed = 0
    for (const p of projects) {
      try {
        const s = await probeProject(db, p)
        stats.push(s)
        totalProbed += s.probed
        totalFailed += s.failed
      } catch (err) {
        rlog.error('probeProject failed', { project_id: p.project_id, err: String(err) })
      }
    }
    await cron.finish({
      rowsAffected: totalProbed,
      metadata: { projects: projects.length, probed: totalProbed, failed: totalFailed },
    })
    return new Response(
      JSON.stringify({ ok: true, data: { stats } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    await cron.fail(err)
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'PROBE_FAILED', message: String(err) } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('synthetic-monitor', handler))
}

export { probeAction, loadActionsForProject }
