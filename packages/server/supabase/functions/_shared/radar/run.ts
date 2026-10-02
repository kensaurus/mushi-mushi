/**
 * FILE: packages/server/supabase/functions/_shared/radar/run.ts
 * PURPOSE: Run the scheduled hole checks (Plan 020 Phase 1) for one project
 *          and record them as one `gate_runs` row (gate `portfolio_radar`) plus its
 *          `gate_findings`; accept the host-CI push (gate `portfolio_radar_ci`); and
 *          read both back as one list of detectors.
 *
 * Never green by default: every rule in RADAR_RULE_IDS appears in the read
 * model. A rule with no result reads `unknown` ("Not checked yet"), and a run
 * in which nothing could be checked is stored as `skipped`, not `pass`.
 */

import type { getServiceClient } from '../db.ts'
import type { RecipeRepo, RecipeRepoResolution } from '../recipe-github.ts'
import { runPublicProbes, type ProbeFetcher } from './public-probes.ts'
import { evaluateStorePolicy } from './store-policy.ts'
import { extractRepoFacts, isRepoScanPath } from './repo-scan.ts'
import { supabaseRadarResults } from '../connectors/supabase.ts'
import { llmUsageConnector } from '../connectors/llm-usage.ts'
import { revenuecatConnector } from '../connectors/revenuecat.ts'
import type { ConnectorSnapshot } from '../connectors/types.ts'
import {
  RADAR_RULE_IDS,
  RADAR_RULES,
  type DetectorResult,
  type DetectorState,
  type PublicProbeTarget,
  type RadarFinding,
  type RadarRuleId,
  type RepoFacts,
} from './types.ts'

type Db = ReturnType<typeof getServiceClient>

export const RADAR_GATE = 'portfolio_radar'
export const RADAR_CI_GATE = 'portfolio_radar_ci'
/** A host-CI policy report newer than this makes the scheduled run skip its own repo read. */
export const CI_FACTS_FRESH_DAYS = 14
/** Rules only the host's CI can check (whole-repo scans; Mushi never clones). */
export const CI_ONLY_RULES: readonly RadarRuleId[] = ['storage_sql_delete']
const POLICY_RULES: readonly RadarRuleId[] = ['play_target_sdk_behind', 'ios_sdk_behind']
const MAX_STORED_FINDINGS = 200

// ── target ───────────────────────────────────────────────────────────────────

function str(v: unknown, max = 300): string | null {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null
}

function strList(v: unknown, max = 20): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => Boolean(x)).slice(0, max) : []
}

function httpsUrl(v: unknown): string | null {
  const s = str(v, 2000)
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * What the public probes look at, from the recipe manifest (untrusted repo
 * text, read defensively): the `store` block (Plan 020 §5.2), `app.ids`,
 * `links.domains` and the deploy targets' URLs.
 */
export function targetFromManifest(manifest: unknown): PublicProbeTarget {
  const m = (manifest && typeof manifest === 'object' ? manifest : {}) as Record<string, any>
  const store = (m.store && typeof m.store === 'object' ? m.store : {}) as Record<string, any>
  const ids = (m.app?.ids && typeof m.app.ids === 'object' ? m.app.ids : {}) as Record<string, unknown>
  const iosBundle = str(store.ios?.bundleId) ?? str(ids.bundleId)
  const iosApple = str(store.ios?.appleId) ?? str(ids.appStoreId)
  const androidPkg = str(store.android?.package) ?? str(ids.androidPackage)
  const siteUrls = new Set<string>()
  for (const t of Array.isArray(m.deploy?.targets) ? m.deploy.targets.slice(0, 20) : []) {
    const u = httpsUrl((t as Record<string, unknown>)?.url)
    if (u) siteUrls.add(u)
  }
  const domains = new Set<string>(strList(m.links?.domains).map((d) => d.toLowerCase()))
  for (const u of siteUrls) domains.add(new URL(u).hostname)
  return {
    brandName: str(store.brandName, 120),
    ios: iosBundle || iosApple ? { bundleId: iosBundle, appleId: iosApple } : null,
    android: androidPkg ? { package: androidPkg } : null,
    locales: strList(store.locales),
    domains: [...domains].slice(0, 20),
    siteUrls: [...siteUrls].slice(0, 10),
    privacyUrl: httpsUrl(store.privacyUrl) ?? (str(store.privacyUrl) ? String(store.privacyUrl) : null),
  }
}

// ── connector-backed rules ───────────────────────────────────────────────────

const CONNECTOR_TITLE: Record<string, string> = { supabase: 'Supabase', llm_usage: 'AI provider spend', revenuecat: 'RevenueCat' }

/**
 * Radar results from the connectors' current snapshots (recipe-collector runs
 * them earlier each day). No snapshot → `unknown` with the connect step; a
 * failed snapshot → `error`; never `ok` from nothing.
 */
export async function connectorRadarResults(db: Db, projectId: string, manifest: unknown): Promise<DetectorResult[]> {
  const kinds = ['supabase', 'llm_usage', 'revenuecat'] as const
  const { data } = await db
    .from('connector_snapshots')
    .select('kind, ok, error, snapshot')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .in('kind', [...kinds])
  const snaps = (data ?? []) as Array<{ kind: string; ok: boolean; error: string | null; snapshot: ConnectorSnapshot | null }>
  // Which of these kinds are connected but not collected yet (vs not connected at all).
  const [{ data: binds }, { data: owned }, { data: settings }] = await Promise.all([
    db.from('connector_bindings').select('connector_instance_id').eq('project_id', projectId),
    db.from('connector_instances').select('id, kind').eq('project_id', projectId),
    db.from('project_settings').select('supabase_project_ref').eq('project_id', projectId).maybeSingle(),
  ])
  const boundIds = ((binds ?? []) as Array<{ connector_instance_id: string }>).map((b) => b.connector_instance_id)
  const { data: boundRows } = boundIds.length ? await db.from('connector_instances').select('id, kind').in('id', boundIds) : { data: [] }
  const connectedKinds = new Set([...((owned ?? []) as Array<{ kind: string }>), ...((boundRows ?? []) as Array<{ kind: string }>)].map((r) => r.kind))
  if ((settings as { supabase_project_ref?: string | null } | null)?.supabase_project_ref) connectedKinds.add('supabase')
  const out: DetectorResult[] = []
  for (const kind of kinds) {
    const rules = RADAR_RULE_IDS.filter((id) => RADAR_RULES[id].connector === kind)
    const snap = snaps.find((x) => x.kind === kind)
    if (!snap) {
      const reason = connectedKinds.has(kind)
        ? `${CONNECTOR_TITLE[kind]} is connected but has not been read yet. It is read daily at 03:35 UTC.`
        : `Not checked: connect ${CONNECTOR_TITLE[kind]} to check this.`
      for (const ruleId of rules) out.push({ ruleId, state: 'unknown', reason, findings: [] })
      continue
    }
    if (!snap.ok || !snap.snapshot) {
      for (const ruleId of rules) out.push({ ruleId, state: 'error', reason: `${CONNECTOR_TITLE[kind]} could not be read: ${(snap.error ?? 'unknown error').slice(0, 200)}`, findings: [] })
      continue
    }
    if (kind === 'supabase') {
      for (const r of supabaseRadarResults(snap.snapshot.facts as Record<string, unknown>)) {
        if ((rules as readonly string[]).includes(r.ruleId)) out.push(r as unknown as DetectorResult)
      }
      continue
    }
    const connector = kind === 'llm_usage' ? llmUsageConnector : revenuecatConnector
    const drift = connector.detectDrift ? connector.detectDrift(null, snap.snapshot, kind === 'revenuecat' ? { [projectId]: manifest } : manifest) : []
    for (const ruleId of rules) {
      const hits = drift.filter((d) => d.ruleId === ruleId)
      out.push({
        ruleId,
        state: hits.length ? 'finding' : 'ok',
        reason: hits.length ? `${hits.length} to fix.` : `Checked through ${CONNECTOR_TITLE[kind]}; nothing found.`,
        findings: hits.map((d) => ({ ruleId, severity: d.severity, message: d.message, target: null, filePath: d.filePath ?? null, fix: d.suggestedFix?.text ?? 'Open the connector page for detail.' })),
      })
    }
  }
  return out
}

// ── scheduled run ────────────────────────────────────────────────────────────

export interface RadarRunDeps {
  fetcher: ProbeFetcher
  resolveRepo: (db: Db, projectId: string) => Promise<RecipeRepoResolution>
  getDefaultHead: (repo: RecipeRepo) => Promise<{ branch: string; sha: string }>
  listTree: (repo: RecipeRepo, sha: string) => Promise<{ entries: Array<{ path: string; size: number }>; truncated: boolean }>
  readBlobs: (repo: RecipeRepo, sha: string, paths: readonly string[]) => Promise<Map<string, string | null>>
  now: () => Date
}

export interface RadarRunSummary {
  runId: string | null
  status: 'pass' | 'warn' | 'fail' | 'skipped' | 'error'
  results: Array<{ ruleId: RadarRuleId; state: DetectorState; reason: string; findings: number }>
  checked: number
  /** Checks that could not decide. */
  unchecked: number
  /** Checks that failed to run. */
  errored: number
  commitSha: string | null
  error?: string
}

function errMessage(err: unknown): string {
  return ((err as Error)?.message ?? String(err)).slice(0, 300)
}

/** Repo facts for the store-policy rules, read at the default-branch head. */
async function repoPolicyResults(db: Db, projectId: string, deps: RadarRunDeps, now: Date): Promise<{ results: DetectorResult[]; commitSha: string | null }> {
  const unknown = (reason: string): DetectorResult[] => POLICY_RULES.map((ruleId) => ({ ruleId, state: 'unknown' as const, reason, findings: [] }))
  const repo = await deps.resolveRepo(db, projectId).catch((err): RecipeRepoResolution => ({ ok: false, repoConnected: true, tokenAvailable: true, reason: errMessage(err) }))
  if (!repo.ok) return { results: unknown(`Could not read the repo: ${repo.reason}`), commitSha: null }
  try {
    const head = await deps.getDefaultHead(repo.repo)
    const tree = await deps.listTree(repo.repo, head.sha)
    const paths = tree.entries.filter((e) => isRepoScanPath(e.path) && e.size <= 512 * 1024).map((e) => e.path).slice(0, 60)
    const texts = paths.length ? await deps.readBlobs(repo.repo, head.sha, paths) : new Map<string, string | null>()
    const files: Record<string, string> = {}
    for (const [p, t] of texts) if (typeof t === 'string') files[p] = t
    // Presence of the platform folders counts even when no config file matched.
    for (const e of tree.entries) {
      if (e.path.startsWith('android/') && !('android/.present' in files)) files['android/.present'] = ''
      if (e.path.startsWith('ios/') && !('ios/.present' in files)) files['ios/.present'] = ''
    }
    return { results: evaluateStorePolicy(extractRepoFacts(files), now), commitSha: head.sha }
  } catch (err) {
    return { results: unknown(`Could not read the repo: ${errMessage(err)}`), commitSha: null }
  }
}

export function runStatus(results: readonly DetectorResult[]): RadarRunSummary['status'] {
  const findings = results.flatMap((r) => r.findings)
  if (findings.some((f) => f.severity === 'error')) return 'fail'
  // A check that failed to run is never a pass, even when the others found nothing.
  if (results.some((r) => r.state === 'error')) return 'error'
  if (findings.some((f) => f.severity === 'warn')) return 'warn'
  if (!results.some((r) => r.state === 'ok' || r.state === 'finding')) return 'skipped'
  return 'pass'
}

function findingRows(projectId: string, runId: string, results: readonly DetectorResult[]) {
  return results.flatMap((r) => r.findings).slice(0, MAX_STORED_FINDINGS).map((f: RadarFinding) => ({
    gate_run_id: runId,
    project_id: projectId,
    severity: f.severity,
    rule_id: f.ruleId,
    message: f.message.slice(0, 1000),
    file_path: f.filePath ?? null,
    line: f.line ?? null,
    suggested_fix: { fix: f.fix, target: f.target, evidence: f.evidence ?? null },
    allowlisted: false,
  }))
}

async function recordRun(db: Db, projectId: string, gate: string, triggeredBy: string, commitSha: string | null, results: DetectorResult[], extra: Record<string, unknown>, now: Date): Promise<RadarRunSummary> {
  const status = runStatus(results)
  const summary = {
    results: results.map((r) => ({ ruleId: r.ruleId, state: r.state, reason: r.reason.slice(0, 500), findings: r.findings.length })),
    checked: results.filter((r) => r.state === 'ok' || r.state === 'finding').length,
    /** Could not decide (nothing declared, a store or registry did not answer). */
    unchecked: results.filter((r) => r.state === 'unknown').length,
    /** Failed to run (a connector or the repo read threw). Counted apart from `unchecked`. */
    errored: results.filter((r) => r.state === 'error').length,
    ...extra,
  }
  const findings = results.reduce((n, r) => n + r.findings.length, 0)
  const { data: run, error } = await db
    .from('gate_runs')
    .insert({ project_id: projectId, gate, status, summary, findings_count: findings, triggered_by: triggeredBy, commit_sha: commitSha, started_at: now.toISOString(), completed_at: now.toISOString() })
    .select('id')
    .single()
  if (error || !run) throw new Error(`could not record the ${gate} run: ${error?.message ?? 'no row'}`)
  const runId = (run as { id: string }).id
  const rows = findingRows(projectId, runId, results)
  if (rows.length) {
    const { error: fErr } = await db.from('gate_findings').insert(rows)
    if (fErr) {
      // A run whose findings did not land must not read as a pass.
      await db.from('gate_runs').update({ status: 'error', summary: { ...summary, error: `findings not stored: ${fErr.message}` } }).eq('id', runId)
      throw new Error(`could not store the ${gate} findings: ${fErr.message}`)
    }
  }
  return { runId, status, results: summary.results, checked: summary.checked, unchecked: summary.unchecked, errored: summary.errored, commitSha }
}

/** Latest completed run of a gate for a project, or null. */
async function latestRun(db: Db, projectId: string, gate: string): Promise<{ id: string; status: string; summary: Record<string, any> | null; completed_at: string | null; started_at: string; commit_sha: string | null } | null> {
  const { data } = await db
    .from('gate_runs')
    .select('id, status, summary, completed_at, started_at, commit_sha')
    .eq('project_id', projectId)
    .eq('gate', gate)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as never) ?? null
}

/**
 * Run every scheduled detector for one project. Public probes always run
 * (they need only what the manifest declares). The store-policy rules read
 * the repo unless the host's CI reported them within CI_FACTS_FRESH_DAYS, in
 * which case they are left to the CI run so the same hole is not counted twice.
 */
export async function runRadar(db: Db, projectId: string, deps: RadarRunDeps, triggeredBy = 'manual'): Promise<RadarRunSummary> {
  const now = deps.now()
  const { data: snap } = await db.from('app_recipe_snapshots').select('manifest').eq('project_id', projectId).eq('is_current', true).maybeSingle()
  const target = targetFromManifest((snap as { manifest?: unknown } | null)?.manifest ?? null)
  const manifest = (snap as { manifest?: unknown } | null)?.manifest ?? null
  const results: DetectorResult[] = await runPublicProbes(target, deps.fetcher, now)
  results.push(...await connectorRadarResults(db, projectId, manifest))

  const ci = await latestRun(db, projectId, RADAR_CI_GATE)
  const ciFresh = ci?.completed_at && now.getTime() - Date.parse(ci.completed_at) < CI_FACTS_FRESH_DAYS * 86400_000 &&
    Array.isArray(ci.summary?.results) && ci.summary!.results.some((r: { ruleId?: string; state?: string }) => POLICY_RULES.includes(r.ruleId as RadarRuleId) && r.state !== 'unknown')
  let commitSha: string | null = null
  const extra: Record<string, unknown> = { ciOnly: CI_ONLY_RULES }
  if (ciFresh) {
    extra.policyFromCi = ci!.completed_at
  } else {
    const repo = await repoPolicyResults(db, projectId, deps, now)
    results.push(...repo.results)
    commitSha = repo.commitSha
  }
  return recordRun(db, projectId, RADAR_GATE, triggeredBy, commitSha, results, extra, now)
}

// ── host-CI push ─────────────────────────────────────────────────────────────

export interface CiRadarPush {
  commitSha: string | null
  /** Rules the CI step actually ran; a rule it ran with no finding is `ok`. */
  scanned: RadarRuleId[]
  findings: RadarFinding[]
  /** Build-config files (paths matching isRepoScanPath) for the store-policy rules. */
  files: Record<string, string>
}

/** Record what the host's CI checked as one `portfolio_radar_ci` run. */
export async function recordCiRadar(db: Db, projectId: string, push: CiRadarPush, now: Date): Promise<RadarRunSummary> {
  const results: DetectorResult[] = []
  for (const ruleId of CI_ONLY_RULES) {
    if (!push.scanned.includes(ruleId)) continue
    const findings = push.findings.filter((f) => f.ruleId === ruleId)
    results.push({
      ruleId,
      state: findings.length ? 'finding' : 'ok',
      reason: findings.length ? `Your CI found ${findings.length} place${findings.length === 1 ? '' : 's'} to fix.` : 'Your CI scanned the repo and found nothing.',
      findings,
    })
  }
  const files = Object.fromEntries(Object.entries(push.files).filter(([p]) => isRepoScanPath(p)))
  if (Object.keys(files).length > 0) results.push(...evaluateStorePolicy(extractRepoFacts(files), now))
  return recordRun(db, projectId, RADAR_CI_GATE, 'ci', push.commitSha, results, {}, now)
}

// ── read model ───────────────────────────────────────────────────────────────

export interface RadarDetectorView {
  ruleId: RadarRuleId
  title: string
  prevents: string
  source: 'public_probe' | 'repo_scan' | 'host_ci' | 'connector'
  state: DetectorState
  reason: string
  checkedAt: string | null
  /** Which run answered: Mushi's scheduled check or the host's CI. */
  from: 'portfolio_radar' | 'portfolio_radar_ci' | null
  findings: Array<{ id: string; severity: string; message: string; filePath: string | null; line: number | null; fix: string | null; target: string | null }>
}

export interface RadarView {
  projectId: string
  checkedAt: string | null
  ciCheckedAt: string | null
  status: 'never_run' | 'pass' | 'warn' | 'fail' | 'skipped' | 'error'
  detectors: RadarDetectorView[]
}

/** Every radar rule, answered by the newest of the two runs that checked it; never green by default. */
export async function readRadar(db: Db, projectId: string): Promise<RadarView> {
  const [run, ci] = await Promise.all([latestRun(db, projectId, RADAR_GATE), latestRun(db, projectId, RADAR_CI_GATE)])
  const runIds = [run?.id, ci?.id].filter((x): x is string => Boolean(x))
  const { data: rows } = runIds.length
    ? await db.from('gate_findings').select('id, gate_run_id, severity, rule_id, message, file_path, line, suggested_fix').in('gate_run_id', runIds).eq('allowlisted', false).limit(1000)
    : { data: [] }
  const findings = (rows ?? []) as Array<{ id: string; gate_run_id: string; severity: string; rule_id: string; message: string; file_path: string | null; line: number | null; suggested_fix: { fix?: string; target?: string } | null }>

  const answerFrom = (ruleId: RadarRuleId) => {
    const pick = [
      { gate: 'portfolio_radar' as const, r: run },
      { gate: 'portfolio_radar_ci' as const, r: ci },
    ]
      .map(({ gate, r }) => ({ gate, r, res: (r?.summary?.results as Array<{ ruleId: string; state: DetectorState; reason: string }> | undefined)?.find((x) => x.ruleId === ruleId) }))
      .filter((x) => x.res && x.r)
      .sort((a, b) => Date.parse(b.r!.completed_at ?? b.r!.started_at) - Date.parse(a.r!.completed_at ?? a.r!.started_at))
    return pick[0] ?? null
  }

  const detectors: RadarDetectorView[] = RADAR_RULE_IDS.map((ruleId) => {
    const meta = RADAR_RULES[ruleId]
    const hit = answerFrom(ruleId)
    if (!hit) {
      const reason = CI_ONLY_RULES.includes(ruleId)
        ? 'Not checked yet. This check runs in your CI: add `mushi radar scan --push` to your existing CI job.'
        : 'Not checked yet.'
      return { ruleId, title: meta.title, prevents: meta.prevents, source: meta.source, state: 'unknown', reason, checkedAt: null, from: null, findings: [] }
    }
    return {
      ruleId,
      title: meta.title,
      prevents: meta.prevents,
      source: meta.source,
      state: hit.res!.state,
      reason: hit.res!.reason,
      checkedAt: hit.r!.completed_at ?? hit.r!.started_at,
      from: hit.gate,
      findings: findings
        .filter((f) => f.gate_run_id === hit.r!.id && f.rule_id === ruleId)
        .map((f) => ({ id: f.id, severity: f.severity, message: f.message, filePath: f.file_path, line: f.line, fix: f.suggested_fix?.fix ?? null, target: f.suggested_fix?.target ?? null })),
    }
  })
  const statuses = [run?.status, ci?.status].filter(Boolean) as string[]
  const status: RadarView['status'] = statuses.length === 0
    ? 'never_run'
    : statuses.includes('error') ? 'error' : statuses.includes('fail') ? 'fail' : statuses.includes('warn') ? 'warn' : statuses.every((s) => s === 'skipped') ? 'skipped' : 'pass'
  return { projectId, checkedAt: run?.completed_at ?? null, ciCheckedAt: ci?.completed_at ?? null, status, detectors }
}

export type { RepoFacts }
