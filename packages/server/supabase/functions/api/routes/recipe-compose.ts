/**
 * recipe-compose.ts — builds the App Recipe (Plan 019 Phase 1) for one
 * project from data Mushi already has, plus the design plane (Phase 1b)
 * views over app_recipe_snapshots and design_drift gate runs.
 *
 * Every element goes through deriveElementState (_shared/recipe-state.ts),
 * so "never checked" can only ever come out as `unknown` or `not_connected`.
 * The composer takes a project id and returns a self-contained summary, so
 * the portfolio rollup (Phase P1) can loop over it.
 */

import type { getServiceClient } from '../../_shared/db.ts'
import { cadenceDays, deriveElementState, ELEMENT_META, worstState, type ElementInput } from '../../_shared/recipe-state.ts'
import { judgingSet, toSetSummary, type StoredTokens } from '../../_shared/design-sets.ts'
import { effectiveDesignRules, isWritablePath, RECIPE_MANIFEST_PATH, type RecipeManifest } from '../../_shared/recipe-schema.ts'
import { evaluateContrast } from '../../_shared/design-deviance.ts'
import { DESIGN_GATE, STUCK_SCAN_MS, type SnapshotRow } from '../../_shared/design-plane.ts'
import type { RecipeRepoResolution, RecipeRepo } from '../../_shared/recipe-github.ts'
import type { WorkflowRunSnapshot } from '../../_shared/github.ts'
import { assetMime } from '../../_shared/design-assets.ts'
import type {
  DesignDirection,
  DesignDirectionsResponse,
  DirectionAsset,
  DesignExcerpt,
  DesignPlaneResponse,
  DesignRuleId,
  DevianceFinding,
  DevianceRun,
  DevianceRunStatus,
  ElementState,
  RecipeElementKey,
  RecipeElementSummary,
  RecipeIssue,
  RecipeLink,
  RecipeResponse,
} from '../../_shared/recipe-types.ts'
import { RECIPE_ELEMENT_KEYS } from '../../_shared/recipe-types.ts'

type Db = ReturnType<typeof getServiceClient>

export interface ComposeDeps {
  resolveRepo: (db: Db, projectId: string) => Promise<RecipeRepoResolution>
  getDefaultHead: (repo: RecipeRepo) => Promise<{ branch: string; sha: string }>
  fetchWorkflowRun: (repo: RecipeRepo, branch: string, sha: string) => Promise<WorkflowRunSnapshot | null>
  listActionsNames: (repo: RecipeRepo) => Promise<string[]>
  requiredEnvNames: (projectSlug: string | null) => string[]
  now: () => Date
}

/** Plan 020 hole-check gates; shown in the radar, never counted in the recipe's gates card. */
export const RADAR_GATES = ['portfolio_radar', 'portfolio_radar_ci', 'store_review']
const ELEMENT_DRIFT_GATES = ['ci_drift', 'env_drift', 'deploy_drift']

const INVENTORY_GATES = ['dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim', 'spec_drift', 'orphan_endpoint', 'unknown_call']

interface GateRunRow {
  id: string
  gate: string
  status: string
  started_at: string
  completed_at: string | null
  summary: Record<string, unknown> | null
  findings_count: number | null
  commit_sha: string | null
}

// Five-minute per-isolate cache for the live GitHub reads (CI + env).
const ghCache = new Map<string, { at: number; value: unknown }>()
const GH_CACHE_MS = 5 * 60 * 1000

async function cached<T>(key: string, now: number, fn: () => Promise<T>): Promise<T> {
  const hit = ghCache.get(key)
  if (hit && now - hit.at < GH_CACHE_MS) return hit.value as T
  const value = await fn()
  ghCache.set(key, { at: now, value })
  if (ghCache.size > 500) ghCache.delete(ghCache.keys().next().value as string)
  return value
}

function errMessage(err: unknown): string {
  return (err as Error)?.message ?? String(err)
}

/** Latest completed run per gate among the given rows (rows newest first). */
export function latestPerGate<T extends Pick<GateRunRow, 'gate' | 'status'>>(rows: T[]): T[] {
  const seen = new Map<string, T>()
  for (const r of rows) {
    if (r.status === 'running' || r.status === 'queued') continue
    if (!seen.has(r.gate)) seen.set(r.gate, r)
  }
  return [...seen.values()]
}

async function openFindingCounts(db: Db, runIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (runIds.length === 0) return out
  const { data } = await db
    .from('gate_findings')
    .select('gate_run_id, severity')
    .in('gate_run_id', runIds)
    .eq('allowlisted', false)
    .limit(5000)
  for (const f of (data ?? []) as Array<{ gate_run_id: string; severity: string }>) {
    if (f.severity === 'info') continue
    out.set(f.gate_run_id, (out.get(f.gate_run_id) ?? 0) + 1)
  }
  return out
}

export function isScanRun(r: Pick<GateRunRow, 'summary'>): boolean {
  return (r.summary as { phase?: string } | null)?.phase !== 'refresh'
}

/** A `running` row older than STUCK_SCAN_MS never finished; it reads as `error`, never as running forever. */
export function toDevianceRun(r: GateRunRow, now: Date = new Date()): DevianceRun {
  const s = (r.summary ?? {}) as Record<string, unknown>
  const stuck = r.status === 'running' && now.getTime() - Date.parse(r.started_at) > STUCK_SCAN_MS
  if (stuck) return { ...toDevianceRun({ ...r, status: 'error' }, now), error: 'The scan did not finish (the function stopped before writing a result).' }
  return {
    runId: r.id,
    status: (['running', 'pass', 'warn', 'fail', 'error'].includes(r.status) ? r.status : 'error') as DevianceRunStatus,
    score: typeof s.score === 'number' ? s.score : null,
    scannedFiles: Number(s.scannedFiles ?? 0),
    scannedLines: Number(s.scannedLines ?? 0),
    matchedFiles: Number(s.matchedFiles ?? 0),
    truncated: s.truncated === true,
    commitSha: r.commit_sha,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    breakdown: Array.isArray(s.breakdown) ? (s.breakdown as DevianceRun['breakdown']) : [],
    counts: (s.counts ?? {}) as DevianceRun['counts'],
    storedFindings: Number(s.storedFindings ?? 0),
    error: typeof s.error === 'string' ? s.error : null,
  }
}

export async function loadDesignRuns(db: Db, projectId: string, limit = 30): Promise<GateRunRow[]> {
  const { data, error } = await db
    .from('gate_runs')
    .select('id, gate, status, started_at, completed_at, summary, findings_count, commit_sha')
    .eq('project_id', projectId)
    .eq('gate', DESIGN_GATE)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`gate_runs read failed: ${error.message}`)
  return (data ?? []) as GateRunRow[]
}

export async function loadRunFindings(db: Db, runId: string, limit: number): Promise<DevianceFinding[]> {
  const { data, error } = await db
    .from('gate_findings')
    .select('id, severity, rule_id, message, file_path, line, col, suggested_fix, allowlisted')
    .eq('gate_run_id', runId)
    .eq('allowlisted', false)
    .limit(limit)
  if (error) throw new Error(`gate_findings read failed: ${error.message}`)
  const order: Record<string, number> = { error: 0, warn: 1, info: 2 }
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((f) => {
      const fix = (f.suggested_fix ?? {}) as { value?: string; suggestion?: DevianceFinding['suggestion'] }
      return {
        id: f.id as string,
        rule_id: f.rule_id as DesignRuleId,
        severity: f.severity as DevianceFinding['severity'],
        file_path: (f.file_path as string | null) ?? null,
        line: (f.line as number | null) ?? null,
        col: (f.col as number | null) ?? null,
        value: fix.value ?? '',
        message: f.message as string,
        suggestion: fix.suggestion ?? null,
      }
    })
    .sort((a, b) => order[a.severity] - order[b.severity] || (a.file_path ?? '').localeCompare(b.file_path ?? '') || (a.line ?? 0) - (b.line ?? 0))
}

/** The design inputs shared by the recipe card and the design page. */
export async function loadDesignState(db: Db, projectId: string, snapshot: SnapshotRow | null, repo: RecipeRepoResolution | null, now: Date) {
  const runs = await loadDesignRuns(db, projectId)
  const scans = runs.filter(isScanRun)
  const latestScan = scans[0] ?? null
  const latestCompleted = scans.find((r) => toDevianceRun(r, now).status !== 'running') ?? null
  const latestError = runs.find((r) => r.status === 'error') ?? null
  const lastError = latestError
    ? { at: latestError.completed_at ?? latestError.started_at, message: String((latestError.summary as { error?: string } | null)?.error ?? 'unknown error') }
    : null
  let openFindings = 0
  if (latestCompleted && toDevianceRun(latestCompleted, now).status !== 'error') {
    const counts = await openFindingCounts(db, [latestCompleted.id])
    openFindings = counts.get(latestCompleted.id) ?? 0
  }
  const set = judgingSet((snapshot?.tokens ?? null) as StoredTokens | null)
  const input: ElementInput = {
    key: 'design',
    repoConnected: repo ? repo.ok || repo.repoConnected : false,
    tokenAvailable: repo ? repo.ok || repo.tokenAvailable : false,
    snapshotAt: snapshot?.captured_at ?? null,
    manifestPresent: snapshot ? snapshot.manifest !== null : null,
    manifestErrors: (snapshot?.validation_errors ?? []).filter((i) => i.severity === 'error').length,
    tokenCount: set?.tokens.length ?? 0,
    lastError,
    runAt: latestScan?.completed_at ?? latestScan?.started_at ?? null,
    runStatus: latestScan ? toDevianceRun(latestScan, now).status : null,
    openFindings,
    score: latestCompleted ? toDevianceRun(latestCompleted, now).score : null,
  }
  return { runs, scans, latestScan, latestCompleted, lastError, openFindings, set, state: deriveElementState(input, now), input }
}

// ── The recipe ───────────────────────────────────────────────────────────────

export interface ComposedRecipe {
  response: RecipeResponse
  details: Record<RecipeElementKey, Record<string, unknown>>
}

function summary(key: RecipeElementKey, st: { state: ElementState; reason: string }, lastCheckedAt: string | null, facts: RecipeElementSummary['facts'], findingsCount: number, links: RecipeLink[]): RecipeElementSummary {
  return { key, label: ELEMENT_META[key].label, lane: ELEMENT_META[key].lane, state: st.state, reason: st.reason, lastCheckedAt, facts, findingsCount, links }
}

export async function composeRecipe(db: Db, deps: ComposeDeps, projectId: string): Promise<ComposedRecipe> {
  const now = deps.now()
  const [projectRes, settingsRes, snapshot, repo] = await Promise.all([
    db.from('projects').select('id, slug, organization_id').eq('id', projectId).maybeSingle(),
    db.from('project_settings').select('supabase_project_ref, sentry_dsn, sentry_org_slug, sentry_project_slug, slack_channel_id, slack_bot_token_ref, linear_api_key_ref, linear_access_token_ref').eq('project_id', projectId).maybeSingle(),
    db.from('app_recipe_snapshots').select('*').eq('project_id', projectId).eq('is_current', true).maybeSingle().then((r) => (r.data as SnapshotRow | null) ?? null),
    deps.resolveRepo(db, projectId).catch((err): RecipeRepoResolution => ({ ok: false, repoConnected: true, tokenAvailable: true, reason: errMessage(err) })),
  ])
  const project = (projectRes.data ?? null) as { slug?: string | null; organization_id?: string | null } | null
  const settings = (settingsRes.data ?? {}) as Record<string, string | null>
  const manifest = (snapshot?.manifest ?? null) as RecipeManifest | null

  // Gate runs (every gate) — newest first.
  const { data: gateRows } = await db
    .from('gate_runs')
    .select('id, gate, status, started_at, completed_at, summary, findings_count, commit_sha')
    .eq('project_id', projectId)
    .order('started_at', { ascending: false })
    .limit(300)
  const allRuns = (gateRows ?? []) as GateRunRow[]
  // The radar gates (Plan 020) are hole checks with their own column, not recipe gates.
  const latest = latestPerGate(allRuns.filter((r) => (r.gate !== DESIGN_GATE || isScanRun(r)) && !RADAR_GATES.includes(r.gate)))
  const findingCounts = await openFindingCounts(db, latest.map((r) => r.id))
  /** Open findings of an element's own drift gate (Phase 2); undefined when that gate never ran. */
  const driftOf = (gate: string): number | undefined => {
    const r = latest.find((x) => x.gate === gate)
    return r ? findingCounts.get(r.id) ?? 0 : undefined
  }

  // ── schema
  const { data: schemaSnap } = await db
    .from('backend_schema_snapshots')
    .select('captured_at, schema_hash')
    .eq('project_id', projectId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const schemaRun = latest.find((r) => r.gate === 'schema_drift') ?? null
  // Phase 2: the Supabase connector's snapshot counts as a schema read too.
  const { data: supaSnap } = await db
    .from('connector_snapshots')
    .select('observed_at, ok')
    .eq('project_id', projectId)
    .eq('kind', 'supabase')
    .eq('is_current', true)
    .eq('ok', true)
    .maybeSingle()
  const schemaReadAt = [(schemaSnap as { captured_at?: string } | null)?.captured_at, (supaSnap as { observed_at?: string } | null)?.observed_at]
    .filter((x): x is string => Boolean(x))
    .sort()
    .pop() ?? null
  const schemaState = deriveElementState({
    key: 'schema',
    linked: Boolean(settings.supabase_project_ref),
    latestSnapshotAt: schemaReadAt,
    openDriftFindings: schemaRun ? findingCounts.get(schemaRun.id) ?? 0 : 0,
    lastRunStatus: schemaRun?.status ?? null,
  }, now)

  // ── design
  const design = await loadDesignState(db, projectId, snapshot, repo, now)

  // ── routes
  const [{ data: inv }, nodesRes] = await Promise.all([
    db.from('inventories').select('commit_sha, validation_errors, created_at').eq('project_id', projectId).eq('is_current', true).maybeSingle(),
    db.from('graph_nodes').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
  ])
  const invRow = inv as { validation_errors?: unknown[]; commit_sha?: string | null; created_at?: string } | null
  const graphNodes = (nodesRes as { count?: number | null }).count ?? 0
  const invRuns = latest.filter((r) => INVENTORY_GATES.includes(r.gate))
  const invLast = invRuns.map((r) => r.completed_at).filter(Boolean).sort().pop() ?? null
  const invOpen = invRuns.reduce((n, r) => n + (findingCounts.get(r.id) ?? 0), 0)
  const routesState = deriveElementState({
    key: 'routes',
    hasInventory: Boolean(invRow),
    graphNodes,
    validationErrors: Array.isArray(invRow?.validation_errors) ? invRow!.validation_errors!.length : 0,
    lastGateRunAt: invLast,
    openFindings: invOpen,
  }, now)

  // ── gates
  const cadence = Math.min(...Object.values(manifest?.gates?.cadence ?? {}).map((c) => cadenceDays(c, 7)), 7)
  // ci_drift / env_drift / deploy_drift belong to their own elements, not the gates card.
  const gateInputs = latest.filter((r) => !ELEMENT_DRIFT_GATES.includes(r.gate)).map((r) => ({ gate: r.gate, status: r.status, completedAt: r.completed_at, openFindings: findingCounts.get(r.id) ?? 0 }))
  const gatesState = deriveElementState({ key: 'gates', runs: gateInputs, cadenceDays: cadence }, now)
  const { data: metricRows } = await db
    .from('metric_series')
    .select('metric_name, dimension, value, ts')
    .eq('project_id', projectId)
    .order('ts', { ascending: false })
    .limit(200)
  const latestMetrics = new Map<string, { value: number; ts: string; dimension: string | null }>()
  for (const m of (metricRows ?? []) as Array<{ metric_name: string; dimension: string | null; value: number; ts: string }>) {
    const k = `${m.metric_name}${m.dimension ? `:${m.dimension}` : ''}`
    if (!latestMetrics.has(k)) latestMetrics.set(k, { value: m.value, ts: m.ts, dimension: m.dimension })
  }

  // ── ci + env (live GitHub, cached 5 min)
  let ciInput: ElementInput = { key: 'ci', repoConnected: false, tokenAvailable: false, fetchError: null, run: null }
  let envInput: ElementInput = { key: 'env', repoConnected: false, tokenAvailable: false, fetchError: null, required: deps.requiredEnvNames(project?.slug ?? null), missing: null }
  let ciDetail: Record<string, unknown> = {}
  let presentNames: string[] | null = null
  if (repo.ok) {
    const nowMs = now.getTime()
    try {
      const head = await cached(`head:${projectId}`, nowMs, () => deps.getDefaultHead(repo.repo))
      const run = await cached(`ci:${projectId}:${head.sha}`, nowMs, () => deps.fetchWorkflowRun(repo.repo, head.branch, head.sha))
      ciInput = { key: 'ci', repoConnected: true, tokenAvailable: true, fetchError: null, run: run ? { status: run.status, conclusion: run.conclusion, updatedAt: run.updatedAt, name: run.name } : null, driftFindings: driftOf('ci_drift') }
      ciDetail = { branch: head.branch, headSha: head.sha, run }
    } catch (err) {
      ciInput = { key: 'ci', repoConnected: true, tokenAvailable: true, fetchError: errMessage(err), run: null }
    }
    try {
      presentNames = await cached(`env:${projectId}`, nowMs, () => deps.listActionsNames(repo.repo))
      const required = deps.requiredEnvNames(project?.slug ?? null)
      envInput = { key: 'env', repoConnected: true, tokenAvailable: true, fetchError: null, required, missing: required.filter((n) => !presentNames!.includes(n)), driftFindings: driftOf('env_drift') }
    } catch (err) {
      envInput = { key: 'env', repoConnected: true, tokenAvailable: true, fetchError: errMessage(err), required: deps.requiredEnvNames(project?.slug ?? null), missing: null }
    }
  } else {
    ciInput = { key: 'ci', repoConnected: repo.repoConnected, tokenAvailable: repo.tokenAvailable, fetchError: null, run: null }
    envInput = { key: 'env', repoConnected: repo.repoConnected, tokenAvailable: repo.tokenAvailable, fetchError: null, required: deps.requiredEnvNames(project?.slug ?? null), missing: null }
  }
  const ciState = deriveElementState(ciInput, now)
  const envState = deriveElementState(envInput, now)

  // ── deploy
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString()
  const [{ data: releases }, { data: reportEnvs }] = await Promise.all([
    db.from('releases').select('version, status, published_at, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(10),
    db.from('reports').select('environment, created_at').eq('project_id', projectId).gte('created_at', since).order('created_at', { ascending: false }).limit(500),
  ])
  const versions = new Map<string, number>()
  for (const r of (reportEnvs ?? []) as Array<{ environment: Record<string, unknown> | null }>) {
    const v = r.environment?.app_version
    if (typeof v === 'string' && v.length <= 40) {
      const platform = typeof r.environment?.platform === 'string' ? r.environment.platform : 'unknown'
      const key = `${platform} ${v}`
      versions.set(key, (versions.get(key) ?? 0) + 1)
    }
  }
  const releaseRows = (releases ?? []) as Array<{ version: string; status: string; published_at: string | null }>
  const rawTargets = (manifest as { deploy?: { targets?: unknown } } | null)?.deploy?.targets
  const declaredTargets = Array.isArray(rawTargets) ? (rawTargets as Array<{ id?: unknown }>).filter((t) => typeof t?.id === 'string') : []
  const { data: obsRows } = declaredTargets.length
    ? await db.from('deploy_observations').select('target_id, ok, error, observed_at, observed_version, observed_commit').eq('project_id', projectId).order('observed_at', { ascending: false }).limit(100)
    : { data: [] }
  const latestObs = new Map<string, { targetId: string; ok: boolean; observedAt: string; error: string | null; version: string | null; commit: string | null }>()
  for (const o of (obsRows ?? []) as Array<{ target_id: string; ok: boolean; error: string | null; observed_at: string; observed_version: string | null; observed_commit: string | null }>) {
    if (!latestObs.has(o.target_id)) latestObs.set(o.target_id, { targetId: o.target_id, ok: o.ok, observedAt: o.observed_at, error: o.error, version: o.observed_version, commit: o.observed_commit })
  }
  const deployState = deriveElementState({
    key: 'deploy', releaseCount: releaseRows.length, appVersions: [...versions.keys()],
    targetsDeclared: declaredTargets.length, observations: [...latestObs.values()], driftFindings: driftOf('deploy_drift'),
  }, now)

  // ── integrations
  const configured: Array<{ kind: string }> = []
  if (settings.sentry_dsn || settings.sentry_org_slug) configured.push({ kind: 'sentry' })
  if (settings.slack_channel_id || settings.slack_bot_token_ref) configured.push({ kind: 'slack' })
  if (settings.linear_api_key_ref || settings.linear_access_token_ref) configured.push({ kind: 'linear' })
  const { data: health } = await db
    .from('integration_health_history')
    .select('kind, status, checked_at')
    .eq('project_id', projectId)
    .order('checked_at', { ascending: false })
    .limit(100)
  const latestHealth = new Map<string, { status: string; checked_at: string }>()
  for (const h of (health ?? []) as Array<{ kind: string; status: string; checked_at: string }>) {
    if (!latestHealth.has(h.kind)) latestHealth.set(h.kind, h)
  }
  const integrationsList = configured.map((c) => ({ kind: c.kind, health: latestHealth.get(c.kind)?.status ?? null, checkedAt: latestHealth.get(c.kind)?.checked_at ?? null }))
  const integrationsState = deriveElementState({ key: 'integrations', configured: integrationsList }, now)

  const designRun = design.latestCompleted ? toDevianceRun(design.latestCompleted, now) : null
  const elements: Record<RecipeElementKey, RecipeElementSummary> = {
    schema: summary('schema', schemaState, schemaReadAt,
      { linked: Boolean(settings.supabase_project_ref) }, schemaRun ? findingCounts.get(schemaRun.id) ?? 0 : 0,
      [{ label: 'Drift', to: '/drift' }]),
    design: summary('design', design.state, design.latestScan?.completed_at ?? snapshot?.captured_at ?? null, {
      set: design.set?.name ?? null,
      tokens: design.set?.tokens.length ?? 0,
      deviance: designRun?.score ?? null,
      manifest: snapshot ? (snapshot.manifest ? 'present' : 'missing') : 'never read',
    }, design.openFindings, [{ label: 'Design system', to: '/design' }]),
    routes: summary('routes', routesState, invLast, { graphNodes, inventory: invRow ? 'present' : 'none', validationErrors: Array.isArray(invRow?.validation_errors) ? invRow!.validation_errors!.length : 0 }, invOpen,
      [{ label: 'Inventory', to: '/inventory' }]),
    gates: summary('gates', gatesState, latest.map((r) => r.completed_at).filter(Boolean).sort().pop() ?? null,
      { gates: latest.length, cadenceDays: cadence, bundleKb: latestMetrics.get('bundle.web.gzip_kb')?.value ?? null }, gateInputs.reduce((n, g) => n + g.openFindings, 0),
      [{ label: 'Code health', to: '/code-health' }]),
    ci: summary('ci', ciState, ciInput.key === 'ci' ? ciInput.run?.updatedAt ?? null : null,
      { branch: (ciDetail.branch as string | undefined) ?? null, conclusion: ciInput.key === 'ci' ? ciInput.run?.conclusion ?? null : null }, 0,
      ciInput.key === 'ci' && (ciDetail.run as WorkflowRunSnapshot | null)?.htmlUrl ? [{ label: 'Workflow run', to: (ciDetail.run as WorkflowRunSnapshot).htmlUrl! }] : []),
    deploy: summary('deploy', deployState, releaseRows[0]?.published_at ?? null,
      { releases: releaseRows.length, latestRelease: releaseRows[0]?.version ?? null, versionsSeen: versions.size }, 0,
      [{ label: 'Releases', to: '/releases' }]),
    env: summary('env', envState, null,
      { required: envInput.key === 'env' ? envInput.required.length : 0, missing: envInput.key === 'env' ? envInput.missing?.length ?? null : null }, envInput.key === 'env' ? envInput.missing?.length ?? 0 : 0,
      [{ label: 'Connect', to: '/connect' }]),
    integrations: summary('integrations', integrationsState, integrationsList.map((i) => i.checkedAt).filter(Boolean).sort().pop() ?? null,
      { connected: integrationsList.length }, integrationsList.filter((i) => i.health === 'down' || i.health === 'degraded').length,
      [{ label: 'Integrations', to: '/integrations' }]),
  }

  const details: Record<RecipeElementKey, Record<string, unknown>> = {
    schema: { latestSnapshot: schemaSnap ?? null, lastRun: schemaRun, supabaseProjectRefSet: Boolean(settings.supabase_project_ref) },
    design: {
      snapshotAt: snapshot?.captured_at ?? null,
      commitSha: snapshot?.commit_sha ?? null,
      set: design.set?.name ?? null,
      tokenCount: design.set?.tokens.length ?? 0,
      latestRun: designRun,
      lastError: design.lastError,
      manifestIssues: snapshot?.validation_errors ?? [],
    },
    routes: { inventory: invRow, graphNodes, gateRuns: invRuns.map((r) => ({ gate: r.gate, status: r.status, completedAt: r.completed_at, openFindings: findingCounts.get(r.id) ?? 0 })) },
    gates: { runs: gateInputs, latestMetrics: Object.fromEntries(latestMetrics), budgets: manifest?.gates?.budgets ?? {} },
    ci: { ...ciDetail, error: ciInput.key === 'ci' ? ciInput.fetchError : null },
    deploy: { releases: releaseRows, appVersions30d: Object.fromEntries(versions), targets: [...latestObs.values()], declaredTargets: declaredTargets.length },
    env: { required: envInput.key === 'env' ? envInput.required : [], missing: envInput.key === 'env' ? envInput.missing : null, presentCount: presentNames?.length ?? null, error: envInput.key === 'env' ? envInput.fetchError : null },
    integrations: { configured: integrationsList },
  }

  const manifestIssues = (snapshot?.validation_errors ?? []) as RecipeIssue[]
  const response: RecipeResponse = {
    projectId,
    organizationId: project?.organization_id ?? null,
    generatedAt: now.toISOString(),
    worst: worstState(RECIPE_ELEMENT_KEYS.map((k) => elements[k].state)),
    elements,
    manifest: {
      present: Boolean(snapshot?.manifest),
      path: snapshot?.manifest ? RECIPE_MANIFEST_PATH : null,
      commitSha: snapshot?.commit_sha ?? null,
      capturedAt: snapshot?.captured_at ?? null,
      validationErrors: manifestIssues,
    },
    snapshotHash: snapshot?.tokens_hash ?? null,
  }
  return { response, details }
}

// ── Design plane ─────────────────────────────────────────────────────────────

export async function composeDesignPlane(db: Db, projectId: string, snapshot: SnapshotRow | null, repo: RecipeRepoResolution, direction: string | null, now: Date): Promise<DesignPlaneResponse> {
  const design = await loadDesignState(db, projectId, snapshot, repo, now)
  const stored = (snapshot?.tokens ?? null) as StoredTokens | null
  const sets = stored?.sets ?? []
  const shown = (direction ? sets.find((s) => s.name === direction) : null) ?? design.set ?? sets[0] ?? null
  const manifest = (snapshot?.manifest ?? null) as RecipeManifest | null
  const rules = effectiveDesignRules(manifest)
  const contrast = evaluateContrast(shown?.tokens ?? [], manifest?.design?.contrast ?? [])
  const latest = design.latestCompleted ? toDevianceRun(design.latestCompleted, now) : null
  const topFindings = latest && latest.status !== 'error' ? await loadRunFindings(db, latest.runId, 50) : []

  // Editability: the shown set's source files that the allowlist lets a PR write.
  let editable: DesignPlaneResponse['editable']
  const sourceFiles = (shown?.files ?? []).filter((f) => f.role === 'source').map((f) => f.path)
  const scope = [...sourceFiles, RECIPE_MANIFEST_PATH]
  const writable = sourceFiles.filter((p) => isWritablePath(p, manifest, scope).ok)
  const manifestWritable = isWritablePath(RECIPE_MANIFEST_PATH, manifest, scope).ok
  if (!snapshot || !manifest) editable = { enabled: false, reason: 'Add a mushi.recipe.json to the repo and refresh.', tokenFiles: [], manifestWritable: false }
  else if (!repo.ok) editable = { enabled: false, reason: repo.reason, tokenFiles: [], manifestWritable: false }
  else if (shown && shown.kind === 'direction' && !shown.active) editable = { enabled: false, reason: `${shown.name} is an inactive direction, kept read-only for comparison. Set it active to edit its tokens.`, tokenFiles: [], manifestWritable }
  else if (shown?.kind === 'export') editable = { enabled: false, reason: `These tokens are a generated export${shown.files[0]?.generator ? ` (${shown.files[0].generator})` : ''}; edit the source files instead.`, tokenFiles: [], manifestWritable }
  else if (writable.length === 0) editable = { enabled: false, reason: 'None of these token files is in change.allowPaths of mushi.recipe.json.', tokenFiles: [], manifestWritable }
  else editable = { enabled: true, reason: null, tokenFiles: writable, manifestWritable }

  const trend = design.scans
    .map((r) => toDevianceRun(r, now))
    .filter((r) => r.status !== 'running')
    .slice(0, 30)
    .reverse()
    .map((r) => ({ at: r.completedAt ?? r.startedAt, score: r.score, status: r.status }))

  const issues = [...((snapshot?.validation_errors ?? []) as RecipeIssue[]), ...(shown?.issues ?? [])]
  return {
    projectId,
    state: design.state.state,
    reason: design.state.reason,
    snapshot: snapshot ? { id: snapshot.id, capturedAt: snapshot.captured_at, commitSha: snapshot.commit_sha, source: snapshot.source, tokensHash: snapshot.tokens_hash } : null,
    manifest: {
      present: Boolean(manifest),
      path: manifest ? RECIPE_MANIFEST_PATH : null,
      commitSha: snapshot?.commit_sha ?? null,
      capturedAt: snapshot?.captured_at ?? null,
      validationErrors: (snapshot?.validation_errors ?? []) as RecipeIssue[],
    },
    sets: sets.map(toSetSummary),
    shownSet: shown?.name ?? null,
    activeSet: stored?.active ?? null,
    tokens: shown?.tokens ?? [],
    issues,
    contrast,
    components: (snapshot?.components ?? []) as DesignPlaneResponse['components'],
    cssScopes: (stored?.css ?? []).flatMap((f) => f.scopes.map((s) => ({ path: f.path, selector: s.selector, kind: s.kind, vars: s.vars }))),
    rules,
    editable,
    deviance: { latest, trend, topFindings },
    lastError: design.lastError && (!snapshot || Date.parse(design.lastError.at) > Date.parse(snapshot.captured_at)) ? design.lastError : null,
  }
}

/** The capped recipe block for get_fix_context (≤ 4 KB of JSON). */
export function buildDesignExcerpt(plane: Pick<DesignPlaneResponse, 'state' | 'tokens' | 'shownSet' | 'deviance'>, files: string[], fileFindings: DevianceFinding[], maxBytes = 4096): DesignExcerpt {
  const rank = (path: string, cssVar: string | null, ts: string | null) => {
    const g = path.split('.')[0]
    const mapped = cssVar || ts ? 0 : 10
    const group = g === 'color' ? 0 : g === 'font' || g === 'typography' ? 1 : g === 'space' || g === 'spacing' ? 2 : g === 'radius' ? 3 : 4
    return mapped + group
  }
  const candidates = plane.tokens
    .filter((t) => !t.path.includes('.palette.') && t.display.length <= 80)
    .map((t) => ({ path: t.path, value: t.display, cssVar: t.cssVar, ts: t.ts }))
    .sort((a, b) => rank(a.path, a.cssVar, a.ts) - rank(b.path, b.cssVar, b.ts) || a.path.localeCompare(b.path))
  const findings = fileFindings
    .filter((f) => f.file_path && files.includes(f.file_path))
    .slice(0, 20)
    .map((f) => ({ file: f.file_path!, line: f.line, rule: f.rule_id, value: f.value, use: f.suggestion?.cssVar ?? f.suggestion?.token ?? null }))
  const out: DesignExcerpt = {
    state: plane.state,
    set: plane.shownSet,
    tokens: [],
    findings,
    score: plane.deviance.latest?.score ?? null,
    note: 'Use these design tokens (CSS var or TS name) instead of literal colours, fonts, spacing or radii.',
    truncated: false,
  }
  const size = () => new TextEncoder().encode(JSON.stringify(out)).length
  while (out.findings.length > 0 && size() > maxBytes) out.findings.pop()
  for (const t of candidates) {
    out.tokens.push(t)
    if (size() > maxBytes) {
      out.tokens.pop()
      out.truncated = true
      break
    }
  }
  return out
}

// ── Directions board ─────────────────────────────────────────────────────────

const GENERIC_FAMILY = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|emoji|math|fangsong|-apple-system|blinkmacsystemfont|inherit)$/i

const SPECIMENS: Record<DesignDirectionsResponse['specimen']['script'], Omit<DesignDirectionsResponse['specimen'], 'script'>> = {
  thai: { sample: 'ขอน้ำเปล่าหนึ่งขวดครับ', word: 'น้ำ', latin: 'Order water in a shop' },
  japanese: { sample: 'お水を一本ください', word: '水', latin: 'Order water in a shop' },
  korean: { sample: '물 한 병 주세요', word: '물', latin: 'Order water in a shop' },
  chinese: { sample: '请给我一瓶水', word: '水', latin: 'Order water in a shop' },
  arabic: { sample: 'زجاجة ماء من فضلك', word: 'ماء', latin: 'Order water in a shop' },
  devanagari: { sample: 'कृपया एक बोतल पानी दीजिए', word: 'पानी', latin: 'Order water in a shop' },
  latin: { sample: 'The quick brown fox jumps over the lazy dog', word: 'Water', latin: 'Order water in a shop' },
}

/** The project's script, from what its directions say about themselves. */
export function detectScript(text: string): DesignDirectionsResponse['specimen']['script'] {
  if (/[฀-๿]|thai/i.test(text)) return 'thai'
  if (/[぀-ヿ]|japanese|\bjp\b/i.test(text)) return 'japanese'
  if (/[가-힯]|korean|\bkr\b/i.test(text)) return 'korean'
  if (/[一-鿿]|chinese|\b(sc|tc)\b/i.test(text)) return 'chinese'
  if (/[؀-ۿ]|arabic/i.test(text)) return 'arabic'
  if (/[ऀ-ॿ]|devanagari|hindi/i.test(text)) return 'devanagari'
  return 'latin'
}

export function googleFontStylesheet(family: string): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`
}

export async function composeDirections(
  db: Db,
  projectId: string,
  snapshot: SnapshotRow | null,
  repo: RecipeRepoResolution,
  now: Date,
  sign: ((path: string) => Promise<string>) | null,
): Promise<DesignDirectionsResponse> {
  const stored = (snapshot?.tokens ?? null) as StoredTokens | null
  const manifest = (snapshot?.manifest ?? null) as RecipeManifest | null
  const sets = stored?.sets ?? []
  const directionSets = sets.some((s) => s.kind === 'direction') ? sets.filter((s) => s.kind === 'direction') : sets.filter((s) => s.active && s.kind !== 'export')
  const pairs = manifest?.design?.contrast ?? []
  const runs = directionSets.some((s) => s.active) ? (await loadDesignRuns(db, projectId)).filter(isScanRun).map((r) => toDevianceRun(r, now)) : []
  const lastRun = runs.find((r) => r.status !== 'running') ?? null

  const directions: DesignDirection[] = []
  for (const s of directionSets) {
    const assets: DirectionAsset[] = []
    for (const a of s.assets ?? []) {
      const servable = assetMime(a.path) !== null
      assets.push({ path: a.path, kind: a.kind, size: a.size, url: servable && sign ? await sign(a.path) : null })
    }
    directions.push({
      name: s.name,
      displayName: s.meta?.displayName ?? s.name,
      nativeName: s.meta?.nativeName ?? null,
      concept: s.meta?.concept ?? null,
      active: s.active,
      note: s.note ?? null,
      readOnly: !s.active,
      files: s.files,
      tokenCount: s.tokens.length,
      tokens: s.tokens,
      issues: s.issues,
      contrast: evaluateContrast(s.tokens, pairs),
      fonts: s.tokens
        .filter((t) => t.type === 'fontFamily' && Array.isArray(t.value))
        .map((t) => ({ path: t.path, role: t.path.split('.').pop() ?? t.path, families: (t.value as unknown[]).map(String) })),
      motion: s.tokens.filter((t) => t.group === 'motion').map((t) => ({ path: t.path, display: t.display })),
      line: s.tokens
        .filter((t) => t.group === 'border' || t.group === 'radius' || t.path.startsWith('color.line.'))
        .map((t) => ({ path: t.path, display: t.display })),
      assets,
      deviance: s.active && lastRun ? { score: lastRun.score, status: lastRun.status, at: lastRun.completedAt ?? lastRun.startedAt } : null,
    })
  }

  const families = new Set<string>()
  for (const d of directions) for (const f of d.fonts) for (const fam of f.families) if (!GENERIC_FAMILY.test(fam.trim())) families.add(fam.trim())
  const scriptText = directions.map((d) => [d.nativeName, d.concept, ...d.fonts.flatMap((f) => f.families), ...d.tokens.map((t) => t.path)].join(' ')).join(' ')
  const script = detectScript(scriptText)
  const manifestWritable = isWritablePath(RECIPE_MANIFEST_PATH, manifest, [RECIPE_MANIFEST_PATH]).ok
  const editable = !manifest
    ? { enabled: false, reason: 'Add a mushi.recipe.json to the repo and refresh.' }
    : !repo.ok
      ? { enabled: false, reason: repo.reason }
      : !manifestWritable
        ? { enabled: false, reason: 'mushi.recipe.json is not in change.allowPaths, so the active direction cannot be changed by PR.' }
        : { enabled: true, reason: null }
  return {
    projectId,
    activeDirection: directionSets.find((s) => s.active)?.name ?? null,
    directions,
    fontStylesheets: [...families].sort().map(googleFontStylesheet),
    specimen: { script, ...SPECIMENS[script] },
    editable,
  }
}
