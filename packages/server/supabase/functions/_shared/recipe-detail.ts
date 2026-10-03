/**
 * FILE: packages/server/supabase/functions/_shared/recipe-detail.ts
 * PURPOSE: Pure builders for the recipe side panel's per-element views
 *          (gap #17), computed only for GET /recipe/elements/:element:
 *            schemaView  tables of the newest schema snapshot + diff vs the one before
 *            ciView      recent default-branch runs with estimated minutes
 *            deployView  expected (default-branch head) vs observed, per declared target
 *            envView     environment × variable matrix, names only
 *
 * The rule from recipe-state.ts holds here too: something never observed is
 * `unobserved` / `not_checked`, never ok, and never "missing".
 */

import { sameCommit } from './recipe-drift.ts'
import type {
  CiRunRow,
  CiView,
  DeployTargetRow,
  DeployView,
  EnvCell,
  EnvMatrixColumn,
  EnvMatrixRow,
  EnvView,
  SchemaTableChange,
  SchemaTableRow,
  SchemaView,
} from './recipe-types.ts'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export const MAX_SCHEMA_TABLES = 300
export const MAX_CI_RUNS = 15
export const MAX_ENV_ROWS = 100

// ── schema ───────────────────────────────────────────────────────────────────

interface TableShape {
  name: string
  schema: string | null
  rls: boolean | null
  columns: string[] | null
}

/**
 * One snapshot's tables, from either source:
 *   backend_schema_snapshots.schema_json  [{ name, schema, rls_enabled, columns: [{ name }] }]
 *   the Supabase connector's facts.tables [{ name, rls }]
 */
export function tablesOf(raw: unknown): TableShape[] {
  if (!Array.isArray(raw)) return []
  const out: TableShape[] = []
  for (const t of raw) {
    if (!isObj(t)) continue
    const name = str(t.name)
    if (!name) continue
    const rls = typeof t.rls_enabled === 'boolean' ? t.rls_enabled : typeof t.rls === 'boolean' ? t.rls : null
    const columns = Array.isArray(t.columns) ? t.columns.map((c) => (isObj(c) ? str(c.name) : null)).filter((c): c is string => c !== null) : null
    out.push({ name, schema: str(t.schema), rls, columns })
  }
  return out
}

const tableKey = (t: TableShape) => `${t.schema ?? 'public'}.${t.name}`

export function schemaView(
  latest: { capturedAt: string; tables: unknown; source: 'drift_scanner' | 'supabase_connector' } | null,
  previous: { capturedAt: string; tables: unknown } | null,
): SchemaView {
  if (!latest) return { source: null, capturedAt: null, tables: [], totalTables: 0, diff: null }
  const now = tablesOf(latest.tables).sort((a, b) => tableKey(a).localeCompare(tableKey(b)))
  const tables: SchemaTableRow[] = now.slice(0, MAX_SCHEMA_TABLES).map((t) => ({ name: t.name, schema: t.schema, rls: t.rls, columns: t.columns ? t.columns.length : null }))
  let diff: SchemaView['diff'] = null
  if (previous) {
    const before = new Map(tablesOf(previous.tables).map((t) => [tableKey(t), t]))
    const after = new Map(now.map((t) => [tableKey(t), t]))
    const changed: SchemaTableChange[] = []
    for (const [k, t] of after) {
      const p = before.get(k)
      if (!p) continue
      const addedColumns = t.columns && p.columns ? t.columns.filter((c) => !p.columns!.includes(c)) : []
      const removedColumns = t.columns && p.columns ? p.columns.filter((c) => !t.columns!.includes(c)) : []
      const rls = t.rls !== null && p.rls !== null && t.rls !== p.rls ? { from: p.rls, to: t.rls } : null
      if (addedColumns.length || removedColumns.length || rls) changed.push({ name: k, addedColumns, removedColumns, rls })
    }
    diff = {
      previousCapturedAt: previous.capturedAt,
      added: [...after.keys()].filter((k) => !before.has(k)).slice(0, MAX_SCHEMA_TABLES),
      removed: [...before.keys()].filter((k) => !after.has(k)).slice(0, MAX_SCHEMA_TABLES),
      changed: changed.slice(0, MAX_SCHEMA_TABLES),
    }
  }
  return { source: latest.source, capturedAt: latest.capturedAt, tables, totalTables: now.length, diff }
}

// ── ci ───────────────────────────────────────────────────────────────────────

const safeUrl = (v: unknown): string | null => {
  const s = str(v)
  return s && /^https:\/\//i.test(s) ? s : null
}

export function ciView(rows: ReadonlyArray<Obj>): CiView {
  const runs: CiRunRow[] = rows.slice(0, MAX_CI_RUNS).map((r) => {
    const est = r.est_billable_minutes
    const n = typeof est === 'number' ? est : typeof est === 'string' && est.trim() !== '' ? Number(est) : null
    return {
      runId: Number(r.run_id),
      name: str(r.name),
      event: str(r.event),
      branch: str(r.head_branch),
      headSha: str(r.head_sha),
      status: str(r.status),
      conclusion: str(r.conclusion),
      startedAt: str(r.started_at),
      completedAt: str(r.completed_at),
      estMinutes: n !== null && Number.isFinite(n) ? Math.round(n * 10) / 10 : null,
      url: safeUrl(r.html_url),
    }
  })
  const estimated = runs.filter((r) => r.estMinutes !== null)
  return {
    runs,
    estMinutesTotal: estimated.length ? Math.round(estimated.reduce((s, r) => s + (r.estMinutes ?? 0), 0) * 10) / 10 : null,
    estimatedRuns: estimated.length,
    note: 'Minutes are estimated from job durations and runner type (GitHub no longer reports billed minutes per run). macOS counts about 10× Linux.',
  }
}

// ── deploy ───────────────────────────────────────────────────────────────────

export interface ObservationRow {
  target_id: string
  ok: boolean
  error: string | null
  observed_at: string
  observed_version: string | null
  observed_commit: string | null
  source: string
}

/** Declared targets from mushi.recipe.json `deploy.targets[]` (untrusted: shape-checked here). */
export function declaredTargets(manifest: unknown): Array<{ id: string; kind: string | null; environment: string | null; probe: string | null }> {
  const raw = isObj(manifest) && isObj(manifest.deploy) ? manifest.deploy.targets : null
  if (!Array.isArray(raw)) return []
  return raw.filter(isObj).map((t) => ({ id: str(t.id) ?? '', kind: str(t.kind), environment: str(t.environment), probe: isObj(t.probe) ? str(t.probe.type) : null })).filter((t) => t.id !== '').slice(0, 20)
}

export function deployView(input: { manifest: unknown; observations: ReadonlyArray<ObservationRow>; expectedCommit: string | null; expectedVersion: string | null }): DeployView {
  const latest = new Map<string, ObservationRow>()
  for (const o of [...input.observations].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))) {
    if (!latest.has(o.target_id)) latest.set(o.target_id, o)
  }
  const declared = declaredTargets(input.manifest)
  const targets: DeployTargetRow[] = declared.map((t) => {
    const o = latest.get(t.id) ?? null
    const observed = o ? { commit: o.observed_commit, version: o.observed_version, at: o.observed_at, ok: o.ok, error: o.error, source: o.source } : null
    const expected = { commit: input.expectedCommit, version: input.expectedVersion }
    let status: DeployTargetRow['status']
    let reason: string
    if (!o) {
      status = 'unobserved'
      reason = t.probe ? 'Not observed yet: the next daily check probes it.' : 'No probe is declared for this target, so Mushi cannot see what it runs.'
    } else if (!o.ok) {
      status = 'probe_failed'
      reason = `The last check failed${o.error ? `: ${o.error.slice(0, 160)}` : ''}.`
    } else if (!input.expectedCommit || !o.observed_commit) {
      status = 'not_comparable'
      reason = !o.observed_commit ? 'The target reports a version but no commit, so it cannot be compared with the default branch.' : 'The default-branch head is not known yet.'
    } else if (sameCommit(o.observed_commit, input.expectedCommit)) {
      status = 'live'
      reason = 'Runs the default-branch head.'
    } else {
      status = 'behind'
      reason = `Runs ${o.observed_commit.slice(0, 7)}, not the default-branch head ${input.expectedCommit.slice(0, 7)}.`
    }
    return { ...t, expected, observed, status, reason }
  })
  const ids = new Set(declared.map((t) => t.id))
  return {
    expectedCommit: input.expectedCommit,
    expectedVersion: input.expectedVersion,
    targets,
    undeclared: [...latest.keys()].filter((id) => !ids.has(id)).sort().slice(0, 20),
  }
}

// ── env ──────────────────────────────────────────────────────────────────────

const GH_ENV = 'github-environment:'

/**
 * Where the GitHub connector actually listed env names, keyed the way
 * `env.required[].in` names locations: `github-actions` and
 * `github-environment:<name>`. A location that could not be listed is absent,
 * so envDrift and envView skip it instead of calling every name missing.
 * Snapshots taken before `actionsNamesComplete` existed keep their old reading.
 */
export function presentEnvNames(facts: { actionsNames?: string[]; actionsNamesComplete?: boolean; environmentNames?: Record<string, string[]> }): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (facts.actionsNamesComplete !== false) out['github-actions'] = facts.actionsNames ?? []
  for (const [env, names] of Object.entries(facts.environmentNames ?? {})) {
    if (Array.isArray(names)) out[`${GH_ENV}${env}`] = names
  }
  return out
}
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/
const PLATFORM_NAME = /^(GITHUB_|ACTIONS_|RUNNER_)/

function columnLabel(key: string): string {
  if (key === 'github-actions') return 'GitHub Actions (repo)'
  if (key === 'runtime') return 'Runtime'
  return `GitHub env: ${key.slice(GH_ENV.length)}`
}

/**
 * Rows: declared names (env.required, else the names the Mushi SDK needs),
 * then names found in GitHub that nothing declares (capped).
 * Columns: the repo's Actions names, each GitHub environment that is declared
 * or was listed, and runtime when declared (never checked).
 * `present[key]` absent = that location was not listed → `not_checked`.
 */
export function envView(input: { manifest: unknown; fallbackRequired: readonly string[]; present: Readonly<Record<string, readonly string[]>> }): EnvView {
  const req = isObj(input.manifest) && isObj(input.manifest.env) ? input.manifest.env.required : null
  const declared: Array<{ name: string; in: string[] }> = Array.isArray(req)
    ? req.filter(isObj).map((e) => ({ name: str(e.name) ?? '', in: Array.isArray(e.in) ? e.in.filter((x): x is string => typeof x === 'string') : ['github-actions'] })).filter((e) => e.name !== '')
    : input.fallbackRequired.map((name) => ({ name, in: ['github-actions'] }))

  const keys = new Set<string>(['github-actions'])
  for (const d of declared) for (const w of d.in) if (w === 'github-actions' || w === 'runtime' || w.startsWith(GH_ENV)) keys.add(w)
  for (const k of Object.keys(input.present)) if (k.startsWith(GH_ENV)) keys.add(k)
  const order = (k: string) => (k === 'github-actions' ? 0 : k === 'runtime' ? 2 : 1)
  const columns: EnvMatrixColumn[] = [...keys]
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((key) => ({ key, label: columnLabel(key), checked: key !== 'runtime' && Array.isArray(input.present[key]) }))

  const cell = (name: string, where: readonly string[], col: EnvMatrixColumn): EnvCell => {
    const required = where.includes(col.key)
    if (!col.checked) return required ? 'not_checked' : 'not_required'
    const has = input.present[col.key]!.includes(name)
    if (required) return has ? 'present' : 'missing'
    return has ? 'extra' : 'not_required'
  }

  const seen = new Set<string>()
  const rows: EnvMatrixRow[] = []
  for (const d of declared) {
    if (seen.has(d.name)) continue
    seen.add(d.name)
    rows.push({ name: d.name, declared: true, cells: Object.fromEntries(columns.map((c) => [c.key, cell(d.name, d.in, c)])) })
  }
  const found = [...new Set(columns.filter((c) => c.checked).flatMap((c) => input.present[c.key] ?? []))]
    .filter((n) => !seen.has(n) && ENV_NAME.test(n) && !PLATFORM_NAME.test(n))
    .sort()
  const room = Math.max(0, MAX_ENV_ROWS - rows.length)
  for (const name of found.slice(0, room)) rows.push({ name, declared: false, cells: Object.fromEntries(columns.map((c) => [c.key, cell(name, [], c)])) })
  return { columns, rows, truncated: found.length > room }
}
