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
import type {
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
function latestPerGate(rows: GateRunRow[]): GateRunRow[] {
  const seen = new Map<string, GateRunRow>()
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
  const latest = latestPerGate(allRuns.filter((r) => r.gate !== DESIGN_GATE || isScanRun(r)))
  const findingCounts = await openFindingCounts(db, latest.map((r) => r.id))

  // ── schema
  const { data: schemaSnap } = await db
    .from('backend_schema_snapshots')
    .select('captured_at, schema_hash')
    .eq('project_id', projectId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const schemaRun = latest.find((r) => r.gate === 'schema_drift') ?? null
  const schemaState = deriveElementState({
    key: 'schema',
    linked: Boolean(settings.supabase_project_ref),
    latestSnapshotAt: (schemaSnap as { captured_at?: string } | null)?.captured_at ?? null,
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
  const gateInputs = latest.map((r) => ({ gate: r.gate, status: r.status, completedAt: r.completed_at, openFindings: findingCounts.get(r.id) ?? 0 }))
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
      ciInput = { key: 'ci', repoConnected: true, tokenAvailable: true, fetchError: null, run: run ? { status: run.status, conclusion: run.conclusion, updatedAt: run.updatedAt, name: run.name } : null }
      ciDetail = { branch: head.branch, headSha: head.sha, run }
    } catch (err) {
      ciInput = { key: 'ci', repoConnected: true, tokenAvailable: true, fetchError: errMessage(err), run: null }
    }
    try {
      presentNames = await cached(`env:${projectId}`, nowMs, () => deps.listActionsNames(repo.repo))
      const required = deps.requiredEnvNames(project?.slug ?? null)
      envInput = { key: 'env', repoConnected: true, tokenAvailable: true, fetchError: null, required, missing: required.filter((n) => !presentNames!.includes(n)) }
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
  const deployState = deriveElementState({ key: 'deploy', releaseCount: releaseRows.length, appVersions: [...versions.keys()] }, now)

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
    schema: summary('schema', schemaState, (schemaSnap as { captured_at?: string } | null)?.captured_at ?? null,
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
    deploy: { releases: releaseRows, appVersions30d: Object.fromEntries(versions), note: 'No deploy probe yet (Phase 2). Versions come from report environments.' },
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
