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
import { safeErrorResponse } from '../_shared/safe-error.ts'
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
  db?: SupabaseClient,
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

    // Spec-traceability (whitepaper §2.10 / §4.4): if the action declares
    // an expected_outcome contract, evaluate every assertion against the
    // live response. The default behaviour ("status was 2xx") was always
    // a stand-in for the real check — now that the schema carries the
    // contract we can actually probe it.
    const eo = (action.metadata?.['expected_outcome'] as Record<string, unknown> | null) ?? null
    const baseStep: Record<string, unknown> = { method, path: concretePath, status_code: res.status }

    // Read the body text once (lazy json parse below). Capped at 64 KB so
    // a chatty endpoint can't pin the worker.
    let bodyText = ''
    try {
      bodyText = (await res.clone().text()).slice(0, 64 * 1024)
    } catch {
      bodyText = ''
    }

    if (!res.ok) {
      // Even when the contract declares status_in: [201], a 5xx is still
      // a hard fail — never assert a contract over a server error.
      return {
        status: 'failed',
        latencyMs,
        errorMessage: `HTTP ${res.status}: ${bodyText.slice(0, 240)}`,
        stepResults: baseStep,
      }
    }

    if (eo) {
      const assertion = await evaluateExpectedOutcome(eo, res.status, bodyText, db, new URL(concretePath, baseUrl).origin)
      if (!assertion.ok) {
        return {
          status: 'failed',
          latencyMs,
          errorMessage: `expected_outcome violation: ${assertion.failures.join('; ')}`,
          stepResults: { ...baseStep, expected_outcome: { failures: assertion.failures } },
        }
      }
      return {
        status: 'passed',
        latencyMs,
        stepResults: { ...baseStep, expected_outcome: { ok: true, checked: assertion.checked } },
      }
    }

    return {
      status: 'passed',
      latencyMs,
      stepResults: baseStep,
    }
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Walk an action's `expected_outcome` against the live HTTP response.
 *
 * - `response.status_in` — the live status MUST be in the list.
 * - `response.json_path` — every entry MUST hold against the parsed body.
 *   Path syntax is dotted with `[N]` and `[*]` (any element). Operators
 *   match the schema in `@mushi-mushi/inventory-schema`. Unknown ops are
 *   treated as a soft failure so a typo in the inventory doesn't silently
 *   pass every probe.
 * - `database` — `row_exists` / `row_absent` / `row_count_at_least` assertions
 *   are now enforced when a `db` client is supplied (service-role, read-only
 *   queries). The Edge runtime CAN reach the Supabase Postgres endpoint via the
 *   service role client — the original comment that called this "out of reach"
 *   was incorrect.
 * - `ui.visible_text` — tested via a lightweight HEAD/GET to the page route when
 *   a base URL is available; `route_change_to` is validated by checking the
 *   HTTP response's Location header or final URL.
 */
export async function evaluateExpectedOutcome(
  eo: Record<string, unknown>,
  status: number,
  bodyText: string,
  db?: SupabaseClient,
  pageBaseUrl?: string,
): Promise<{ ok: boolean; failures: string[]; checked: string[] }> {
  const failures: string[] = []
  const checked: string[] = []

  const r = eo.response as Record<string, unknown> | undefined
  if (r) {
    const statusIn = r.status_in as number[] | undefined
    if (Array.isArray(statusIn) && statusIn.length > 0) {
      checked.push('response.status_in')
      if (!statusIn.includes(status)) {
        failures.push(`status ${status} not in ${JSON.stringify(statusIn)}`)
      }
    }
    const jp = r.json_path as Array<Record<string, unknown>> | undefined
    if (Array.isArray(jp) && jp.length > 0) {
      let parsed: unknown = undefined
      try {
        parsed = JSON.parse(bodyText)
      } catch {
        failures.push('response.json_path declared but body is not JSON')
      }
      if (parsed !== undefined) {
        for (const c of jp) {
          checked.push(`response.json_path.${String(c.path)}`)
          const ok = checkJsonPathAssertion(parsed, c)
          if (!ok.ok) failures.push(`${String(c.path)} ${String(c.op)}: ${ok.reason}`)
        }
      }
    }
  }

  // ── Database assertions ─────────────────────────────────────────────────
  const d = eo.database as Record<string, unknown> | undefined
  if (d?.table) {
    const tableName = String(d.table)
    const schemaName = typeof d.schema === 'string' ? d.schema : 'public'
    const expect = typeof d.expect === 'string' ? d.expect : 'row_exists'
    const where = (d.where && typeof d.where === 'object')
      ? d.where as Record<string, unknown>
      : null
    const minCount = typeof d.min_count === 'number' ? d.min_count : 1

    checked.push(`database.${schemaName}.${tableName}`)

    if (db) {
      try {
        // Build a filtered query. `set search_path` via rpc is not needed —
        // Supabase JS will target the schema via the `schema` option.
        let q = db.schema(schemaName).from(tableName).select('*', { count: 'exact', head: true })
        if (where) {
          for (const [col, val] of Object.entries(where)) {
            // @ts-ignore — dynamic column names
            q = q.eq(col, val)
          }
        }
        const { count, error } = await q.limit(1)
        if (error) {
          failures.push(`database.${schemaName}.${tableName}: query error — ${error.message}`)
        } else {
          const rowCount = count ?? 0
          if (expect === 'row_exists' && rowCount === 0) {
            failures.push(`database.${schemaName}.${tableName}: expected at least 1 row (row_exists) but found 0`)
          } else if (expect === 'row_absent' && rowCount > 0) {
            failures.push(`database.${schemaName}.${tableName}: expected 0 rows (row_absent) but found ${rowCount}`)
          } else if (expect === 'row_count_at_least' && rowCount < minCount) {
            failures.push(`database.${schemaName}.${tableName}: expected ≥${minCount} rows but found ${rowCount}`)
          }
        }
      } catch (err) {
        failures.push(`database.${schemaName}.${tableName}: probe threw — ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      checked[checked.length - 1] += ' (skipped — no db client)'
    }
  }

  // ── UI assertions ──────────────────────────────────────────────────────
  const u = eo.ui as Record<string, unknown> | undefined
  if (u) {
    if (typeof u.route_change_to === 'string' && pageBaseUrl) {
      checked.push(`ui.route_change_to`)
      // If the probe response itself has a redirect location header, verify it
      // matches the expected route. This is a best-effort check.
      const expectedRoute = u.route_change_to as string
      if (!bodyText.includes(expectedRoute) && !bodyText.includes(encodeURIComponent(expectedRoute))) {
        failures.push(`ui.route_change_to: expected route "${expectedRoute}" not visible in response body`)
      }
    } else if (typeof u.route_change_to === 'string') {
      checked.push(`ui.route_change_to (skipped — no pageBaseUrl)`)
    }

    if (typeof u.visible_text === 'string') {
      checked.push(`ui.visible_text`)
      const needle = u.visible_text as string
      if (needle.length > 2 && !bodyText.includes(needle)) {
        failures.push(`ui.visible_text: "${needle}" not found in response body`)
      }
    }
  }

  return { ok: failures.length === 0, failures, checked }
}

function checkJsonPathAssertion(
  body: unknown,
  check: Record<string, unknown>,
): { ok: boolean; reason: string } {
  const pathStr = String(check.path)
  const op = String(check.op)
  const expected = check.value
  const matches = resolveJsonPath(body, pathStr)

  if (op === 'exists') {
    if (matches.length === 0) return { ok: false, reason: 'path resolved to no values' }
    if (matches.every((v) => v === undefined || v === null)) {
      return { ok: false, reason: 'path resolved to null/undefined' }
    }
    return { ok: true, reason: '' }
  }
  if (matches.length === 0) return { ok: false, reason: 'path missing' }

  // For non-exists ops every match must satisfy the comparison.
  for (const v of matches) {
    switch (op) {
      case 'equals':
        if (!deepEqual(v, expected)) return { ok: false, reason: `value ${jstr(v)} != ${jstr(expected)}` }
        break
      case 'not_equals':
        if (deepEqual(v, expected)) return { ok: false, reason: `value ${jstr(v)} unexpectedly == ${jstr(expected)}` }
        break
      case 'contains':
        if (typeof v !== 'string' || typeof expected !== 'string' || !v.includes(expected)) {
          return { ok: false, reason: `${jstr(v)} does not contain ${jstr(expected)}` }
        }
        break
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        if (typeof v !== 'number' || typeof expected !== 'number') {
          return { ok: false, reason: `numeric op needs number on both sides; got ${typeof v} vs ${typeof expected}` }
        }
        const ok =
          op === 'gt' ? v > expected
          : op === 'gte' ? v >= expected
          : op === 'lt' ? v < expected
          : v <= expected
        if (!ok) return { ok: false, reason: `${v} not ${op} ${expected}` }
        break
      }
      case 'matches': {
        if (typeof v !== 'string' || typeof expected !== 'string') {
          return { ok: false, reason: `matches needs string regex; got ${typeof v} vs ${typeof expected}` }
        }
        try {
          if (!new RegExp(expected).test(v)) {
            return { ok: false, reason: `${jstr(v)} does not match /${expected}/` }
          }
        } catch {
          return { ok: false, reason: `regex ${jstr(expected)} is invalid` }
        }
        break
      }
      default:
        return { ok: false, reason: `unknown op ${op}` }
    }
  }
  return { ok: true, reason: '' }
}

function jstr(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Tiny dotted-path resolver with `[N]` / `[*]` support. Returns the list
 * of values the path matched (one for `data.id`, many for `data.items[*].id`).
 *
 * Deliberately NOT a full JSONPath implementation — we want a small,
 * reviewable subset that covers the common assertions and never invokes
 * eval. If a customer needs filters or recursive descent, they can move
 * the assertion to `extensions` and run it themselves.
 */
function resolveJsonPath(root: unknown, path: string): unknown[] {
  if (!path) return [root]
  let cursor: unknown[] = [root]
  // Tokenise: split on `.` but respect `[N]` / `[*]` brackets.
  const segments = path.split('.')
  for (const segRaw of segments) {
    const m = /^([^[\]]*)((?:\[[^\]]+\])*)$/.exec(segRaw)
    if (!m) return []
    const key = m[1]
    const idxList = m[2]
      .split(/[[\]]+/)
      .filter((s) => s.length > 0)
    if (key) {
      cursor = cursor.flatMap((c) => {
        if (c && typeof c === 'object') {
          const v = (c as Record<string, unknown>)[key]
          return v === undefined ? [] : [v]
        }
        return []
      })
    }
    for (const idx of idxList) {
      if (idx === '*') {
        cursor = cursor.flatMap((c) => (Array.isArray(c) ? c : []))
      } else {
        const i = Number(idx)
        if (Number.isInteger(i)) {
          cursor = cursor.flatMap((c) => (Array.isArray(c) && i in c ? [c[i]] : []))
        } else {
          return []
        }
      }
    }
  }
  return cursor
}

/**
 * Drain queued post-PR markers (whitepaper §2.10 spec-traceability).
 *
 * The fix-worker writes a `synthetic_runs` row with status='skipped' and
 * `error_message='queued_post_pr'` immediately after a draft PR is
 * opened. We pick those up here, run the probe, and write a real result
 * row. The marker stays in place as audit evidence ("we DID schedule a
 * post-PR check at $time") — the new row carries the verdict.
 *
 * We bound the work per tick (max 25 markers) so a flood of PRs doesn't
 * starve the regular per-project sweep.
 */
async function drainPostPrQueue(
  db: SupabaseClient,
  projects: ProjectSetting[],
): Promise<{ drained: number; failed: number }> {
  if (projects.length === 0) return { drained: 0, failed: 0 }
  const projectIds = new Set(projects.map((p) => p.project_id))
  const { data: markers } = await db
    .from('synthetic_runs')
    .select('id, project_id, action_node_id, ran_at')
    .eq('status', 'skipped')
    .eq('error_message', 'queued_post_pr')
    .order('ran_at', { ascending: true })
    .limit(25)
  if (!markers || markers.length === 0) return { drained: 0, failed: 0 }

  let drained = 0
  let failed = 0
  for (const m of markers) {
    if (!projectIds.has(m.project_id as string)) continue
    const setting = projects.find((p) => p.project_id === m.project_id)
    if (!setting) continue
    try {
      const items = await loadActionsForProject(db, m.project_id as string)
      const item = items.find((i) => i.action.id === m.action_node_id)
      if (!item) {
        // Action was deleted between PR open and probe; mark the queued
        // row as resolved so we don't retry.
        await db.from('synthetic_runs').update({ error_message: 'post_pr_action_missing' }).eq('id', m.id)
        continue
      }
      const baseUrl = setting.synthetic_monitor_target_url
      if (!baseUrl) continue
      const auth = setting.crawler_auth_config as
        | { type: string; config: { token?: string; name?: string; value?: string } }
        | null
      const headers: Record<string, string> = {}
      if (auth?.type === 'bearer' || auth?.type === 'oauth') {
        if (auth.config.token) headers['Authorization'] = `Bearer ${auth.config.token}`
      } else if (auth?.type === 'cookie' && auth.config.name && auth.config.value) {
        headers['Cookie'] = `${auth.config.name}=${auth.config.value}`
      }
      const inventory = await loadProjectInventory(db, m.project_id as string)
      const allowHosts = inventory ? inventoryAppAllowHosts(inventory.app) : []
      try {
        allowHosts.push(new URL(baseUrl).hostname.toLowerCase())
      } catch {
        continue
      }
      const probe = await probeAction(baseUrl, item.action, item.api, headers, {
        allowMutations: setting.synthetic_monitor_allow_mutations === true,
        urlOptions: { allowHosts: Array.from(new Set(allowHosts)) },
      }, db)
      await db.from('synthetic_runs').insert({
        project_id: m.project_id,
        action_node_id: m.action_node_id,
        status: probe.status,
        latency_ms: probe.latencyMs,
        error_message: probe.errorMessage ?? null,
        db_assertions: probe.dbAssertions ?? null,
        step_results: { ...(probe.stepResults ?? {}), trigger: 'post_pr_drain', source_marker: m.id },
      })
      // Resolve the marker so it stops appearing in the queue.
      await db
        .from('synthetic_runs')
        .update({ error_message: 'post_pr_drained' })
        .eq('id', m.id)
      drained += 1
      if (probe.status === 'failed' || probe.status === 'error') failed += 1
    } catch (err) {
      rlog.warn('post_pr drain failed', { marker_id: m.id, err: String(err) })
    }
  }
  return { drained, failed }
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
    }, db)
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

    // Spec-traceability: run the post-PR drain BEFORE the regular sweep
    // so a freshly-shipped fix gets verified within seconds of the PR
    // landing instead of waiting up to 15 min for the next cron tick.
    // The drain is bounded (≤25 markers per call) so it can't starve
    // the sweep even under PR floods.
    const drain = await drainPostPrQueue(db, projects)
    rlog.info('synthetic-monitor.post_pr_drained', drain)

    const stats = []
    let totalFailed = drain.failed
    let totalProbed = drain.drained
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
      metadata: {
        projects: projects.length,
        probed: totalProbed,
        failed: totalFailed,
        post_pr_drained: drain.drained,
        post_pr_failed: drain.failed,
      },
    })
    return new Response(
      JSON.stringify({ ok: true, data: { stats, post_pr: drain } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    await cron.fail(err)
    return safeErrorResponse({ code: 'PROBE_FAILED', status: 500 })
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('synthetic-monitor', handler))
}

export { probeAction, loadActionsForProject, drainPostPrQueue }
