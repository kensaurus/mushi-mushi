/**
 * FILE: packages/server/supabase/functions/_shared/design-plane.ts
 * PURPOSE: The I/O half of the design plane (Plan 019 Phase 1b):
 *   - refreshRecipeSnapshot: read mushi.recipe.json and its DTCG token files
 *     from the project's repo at the default-branch head, normalize them, and
 *     store an `app_recipe_snapshots` row;
 *   - runDesignDeviance: scan the repo's source at the snapshot's commit
 *     (bounded) and write a `design_drift` gate run, its findings, and the
 *     `design.deviance_score` metric, then run the project's opt-in deviance
 *     actions (design-actions.ts). The scan itself is design-scan.ts, the
 *     engine `mushi recipe check` runs too.
 *
 * Failures are written down, not swallowed: a failed refresh or scan leaves a
 * `design_drift` gate run with status `error`, so the console renders `error`
 * instead of an old `ok` (the fail-open lesson, repo memory).
 */

import type { getServiceClient } from './db.ts'
import { log } from './logger.ts'
import { normalizeTokenSet, stableStringify } from './dtcg.ts'
import { actOnDesignDeviance } from './design-actions.ts'
import { devianceStatus } from './design-deviance.ts'
import type { DevianceFinding } from './design-engine-types.ts'
import { computeDeviance, SCAN_LIMITS, selectScanFiles, tokenFilePaths } from './design-scan.ts'
import { collectSetAssets, judgingSet, MAX_TOKEN_FILE_BYTES, planTokenSets, readDirectionMeta, type StoredTokens, type StoredTokenSet } from './design-sets.ts'
import { matchAny } from './recipe-glob.ts'
import {
  getDefaultHead,
  listTree,
  readBlobsGraphql,
  readRepoFile,
  RecipeGithubError,
  resolveRecipeRepo,
  type RecipeRepo,
  type RepoFile,
  type TreeEntry,
} from './recipe-github.ts'
import { parseRecipeManifest, RECIPE_MANIFEST_MAX_BYTES, RECIPE_MANIFEST_PATH, type RecipeManifest } from './recipe-schema.ts'
import { scanForSecrets } from './secret-scan.ts'
import { parseCssScopes } from './css-scopes.ts'
import type { StoredCss } from './design-sets.ts'
import type {
  DesignComponentEntry,
  DevianceRun,
  RecipeIssue,
  RecipeRefreshResult,
} from './recipe-types.ts'

type Db = ReturnType<typeof getServiceClient>
const dlog = log.child('design-plane')

export const DESIGN_GATE = 'design_drift'
export const DEVIANCE_METRIC = 'design.deviance_score'
/**
 * A CI push of a branch other than the default (every PR run): kept for its
 * findings and the CI gate, never the shown score, the metric or the
 * auto-fix baseline (isScanRun and previousScanFindings skip it).
 */
export const CI_BRANCH_SCAN_PHASE = 'ci_branch_scan'

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface SnapshotRow {
  id: string
  project_id: string
  organization_id: string | null
  commit_sha: string | null
  source: 'repo_file' | 'ci_ingest' | 'derived' | 'connector'
  manifest: RecipeManifest | null
  tokens: StoredTokens | null
  tokens_hash: string
  components: DesignComponentEntry[] | null
  validation_errors: RecipeIssue[]
  is_current: boolean
  captured_at: string
}

export async function loadCurrentSnapshot(db: Db, projectId: string): Promise<SnapshotRow | null> {
  const { data, error } = await db
    .from('app_recipe_snapshots')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .maybeSingle()
  if (error) throw new Error(`app_recipe_snapshots read failed: ${error.message}`)
  return (data as SnapshotRow | null) ?? null
}

/** Write a failed refresh / scan down as an errored design_drift gate run. */
export async function recordDesignError(db: Db, projectId: string, phase: 'refresh' | 'scan', message: string, commitSha: string | null = null, triggeredBy = 'manual'): Promise<string | null> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('gate_runs')
    .insert({ project_id: projectId, gate: DESIGN_GATE, status: 'error', commit_sha: commitSha, triggered_by: triggeredBy, summary: { phase, error: message.slice(0, 500) }, findings_count: 0, started_at: now, completed_at: now })
    .select('id')
    .single()
  if (error) {
    dlog.error('could not record design_drift error run', { projectId, phase, err: error.message })
    return null
  }
  return (data as { id: string }).id
}

function issue(code: string, message: string, severity: RecipeIssue['severity'] = 'error', file: string | null = null): RecipeIssue {
  return { severity, code, message, file }
}

// ── Refresh ──────────────────────────────────────────────────────────────────

/**
 * Where the recipe files come from: the repo at the default-branch head
 * (GitHub, read by Mushi) or files the host's CI pushed to
 * POST /v1/ingest/recipe (for repos Mushi has no token for).
 */
export interface RecipeFileSource {
  kind: 'repo_file' | 'ci_ingest'
  head: { sha: string; branch: string }
  readFile(path: string, maxBytes: number): Promise<RepoFile>
  listTree(): Promise<{ entries: TreeEntry[]; truncated: boolean }>
}

export async function refreshRecipeSnapshot(db: Db, projectId: string, triggeredBy = 'manual'): Promise<RecipeRefreshResult> {
  let resolved
  try {
    resolved = await resolveRecipeRepo(db, projectId)
  } catch (err) {
    const reason = String((err as Error).message ?? err)
    await recordDesignError(db, projectId, 'refresh', reason, null, triggeredBy)
    return { ok: false, state: 'error', reason, snapshotId: null, tokensHash: null, manifestPresent: false, tokenCount: 0, issues: [] }
  }
  if (!resolved.ok) return { ok: false, state: 'not_connected', reason: resolved.reason, snapshotId: null, tokensHash: null, manifestPresent: false, tokenCount: 0, issues: [] }
  const repo = resolved.repo
  let head
  try {
    head = await getDefaultHead(repo)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await recordDesignError(db, projectId, 'refresh', message, null, triggeredBy)
    return { ok: false, state: 'error', reason: message, snapshotId: null, tokensHash: null, manifestPresent: false, tokenCount: 0, issues: [] }
  }
  return snapshotFromSource(db, projectId, {
    kind: 'repo_file',
    head,
    readFile: (path, maxBytes) => readRepoFile(repo, head.sha, path, maxBytes),
    listTree: () => listTree(repo, head.sha),
  }, triggeredBy)
}

/** Build and store the current recipe snapshot from any file source. */
export async function snapshotFromSource(db: Db, projectId: string, source: RecipeFileSource, triggeredBy = 'manual'): Promise<RecipeRefreshResult> {
  const fail = async (reason: string, state: RecipeRefreshResult['state'] = 'error'): Promise<RecipeRefreshResult> => {
    if (state === 'error') await recordDesignError(db, projectId, 'refresh', reason, null, triggeredBy)
    return { ok: false, state, reason, snapshotId: null, tokensHash: null, manifestPresent: false, tokenCount: 0, issues: [] }
  }
  const head = source.head
  try {
    const manifestFile = await source.readFile(RECIPE_MANIFEST_PATH, RECIPE_MANIFEST_MAX_BYTES)
    const issues: RecipeIssue[] = []
    let manifest: RecipeManifest | null = null
    if (manifestFile.kind === 'too_large') {
      issues.push(issue('MANIFEST_TOO_LARGE', `mushi.recipe.json is ${manifestFile.size} bytes; the cap is ${RECIPE_MANIFEST_MAX_BYTES}.`, 'error', RECIPE_MANIFEST_PATH))
    } else if (manifestFile.kind === 'absent') {
      issues.push(issue('MANIFEST_MISSING', 'No mushi.recipe.json at the repo root.', 'info', RECIPE_MANIFEST_PATH))
    } else {
      const parsed = parseRecipeManifest(manifestFile.text)
      issues.push(...parsed.issues)
      if (parsed.ok) manifest = parsed.manifest
    }

    let stored: StoredTokens = { version: 1, active: null, sets: [] }
    let components: DesignComponentEntry[] = []
    if (manifest) {
      const tree = await source.listTree().catch((err) => {
        issues.push(issue('TREE_UNAVAILABLE', `Could not list the repo tree, so sibling directions and components are skipped: ${String((err as Error).message ?? err)}`, 'warn'))
        return { entries: [], truncated: false }
      })
      if (tree.truncated) issues.push(issue('TREE_TRUNCATED', 'GitHub truncated the repo tree; some directions or components may be missing.', 'warn'))
      const paths = tree.entries.map((e) => e.path)
      const plan = planTokenSets(
        (manifest.design?.tokens ?? []) as Array<{ path: string; role: 'source' | 'export'; generator?: string }>,
        paths,
        (manifest.design?.directions ?? []) as Array<{ name: string; status: 'active' | 'inactive'; tokens: string[]; note?: string }>,
      )
      issues.push(...plan.issues)
      const sets: StoredTokenSet[] = []
      for (const set of plan.sets) {
        const files = []
        for (const f of set.files) {
          const file = await source.readFile(f.path, MAX_TOKEN_FILE_BYTES)
          if (file.kind === 'absent') {
            issues.push(issue('TOKEN_FILE_MISSING', `${f.path} is listed but does not exist on ${head.branch}.`, set.active ? 'error' : 'warn', f.path))
            continue
          }
          if (file.kind === 'too_large') {
            issues.push(issue('TOKEN_FILE_TOO_LARGE', `${f.path} is ${file.size} bytes; the cap is ${MAX_TOKEN_FILE_BYTES}.`, 'error', f.path))
            continue
          }
          const secret = scanForSecrets(file.text)
          if (secret) {
            issues.push(issue('SECRET_DETECTED', `${f.path} contains something shaped like a ${secret}; it was not stored.`, 'error', f.path))
            continue
          }
          files.push({ path: f.path, role: f.role, text: file.text })
        }
        const norm = normalizeTokenSet(files)
        const stored: StoredTokenSet = { ...set, tokens: norm.tokens, issues: norm.issues }
        if (set.kind === 'direction') {
          stored.meta = readDirectionMeta(set.name, files.map((f) => f.text))
          stored.assets = collectSetAssets(set, (manifest.design?.assets ?? []) as Array<{ path: string; kind?: string; direction?: string }>, tree.entries)
        } else if (set.active) {
          stored.assets = collectSetAssets(set, (manifest.design?.assets ?? []) as Array<{ path: string; kind?: string; direction?: string }>, tree.entries)
        }
        sets.push(stored)
      }
      const css: StoredCss[] = []
      for (const entry of (manifest.design?.css ?? []).slice(0, 10) as Array<{ path: string; role?: string; scopes?: string[] }>) {
        try {
          const file = await source.readFile(entry.path, 512 * 1024)
          if (file.kind !== 'file') {
            issues.push(issue('CSS_FILE_UNREADABLE', `${entry.path} is ${file.kind === 'absent' ? 'missing' : 'over 512 KB'}; its scopes were not read.`, 'warn', entry.path))
            continue
          }
          const parsed = parseCssScopes(entry.path, file.text, entry.scopes ?? [])
          issues.push(...parsed.issues)
          css.push({ path: entry.path, role: entry.role ?? 'export', scopes: parsed.scopes })
        } catch (err) {
          issues.push(issue('CSS_FILE_UNREADABLE', `${entry.path} could not be read: ${String((err as Error).message ?? err).slice(0, 160)}`, 'warn', entry.path))
        }
      }
      stored = { version: 1, active: sets.find((s) => s.active)?.name ?? null, sets, css }
      const globs = manifest.design?.components?.globs ?? []
      if (globs.length > 0) {
        components = paths
          .filter((p) => /\.(tsx|jsx|vue|svelte)$/.test(p) && matchAny(p, globs))
          .sort()
          .slice(0, 500)
          .map((p) => ({ name: (p.split('/').pop() ?? p).replace(/\.[^.]+$/, ''), file: p }))
      }
    }

    const tokensHash = await sha256Hex(stableStringify({ manifest, sets: stored.sets.map((s) => ({ name: s.name, tokens: s.tokens })) }))
    const tokenCount = judgingSet(stored)?.tokens.length ?? 0
    const current = await loadCurrentSnapshot(db, projectId)
    const now = new Date().toISOString()
    let snapshotId: string
    if (current && current.tokens_hash === tokensHash) {
      const { error } = await db
        .from('app_recipe_snapshots')
        .update({ captured_at: now, commit_sha: head.sha, validation_errors: issues })
        .eq('id', current.id)
      if (error) throw new Error(`snapshot update failed: ${error.message}`)
      snapshotId = current.id
    } else {
      if (current) {
        const { error } = await db.from('app_recipe_snapshots').update({ is_current: false }).eq('id', current.id)
        if (error) throw new Error(`snapshot rotate failed: ${error.message}`)
      }
      const { data, error } = await db
        .from('app_recipe_snapshots')
        .insert({
          project_id: projectId,
          commit_sha: head.sha,
          source: source.kind,
          manifest,
          tokens: stored,
          tokens_hash: tokensHash,
          components,
          validation_errors: issues,
          is_current: true,
          captured_at: now,
        })
        .select('id')
        .single()
      if (error) throw new Error(`snapshot insert failed: ${error.message}`)
      snapshotId = (data as { id: string }).id
    }
    const state = !manifest ? (issues.some((i) => i.severity === 'error') ? 'error' : 'not_connected') : tokenCount === 0 ? 'not_connected' : 'unknown'
    const reason = !manifest
      ? issues[0]?.message ?? 'No usable mushi.recipe.json.'
      : `Read ${tokenCount} tokens at ${head.sha.slice(0, 7)} on ${head.branch}.`
    return { ok: true, state, reason, snapshotId, tokensHash, manifestPresent: manifest !== null, tokenCount, issues }
  } catch (err) {
    const message = err instanceof RecipeGithubError || err instanceof Error ? err.message : String(err)
    dlog.warn('recipe refresh failed', { projectId, message })
    return fail(message)
  }
}

// ── Deviance run ─────────────────────────────────────────────────────────────

/** A `running` scan older than this never finished (the isolate died); it reads as `error`. */
export const STUCK_SCAN_MS = 15 * 60 * 1000

export type DevianceStart =
  | { ok: true; runId: string; startedAt: string; commitSha: string | null; execute: () => Promise<{ ok: true; run: DevianceRun } | { ok: false; error: string }> }
  | { ok: false; error: string }

/** Scan synchronously (the collector). The api route uses startDesignDeviance. */
export async function runDesignDeviance(db: Db, projectId: string, triggeredBy = 'manual'): Promise<{ ok: true; run: DevianceRun } | { ok: false; error: string }> {
  const started = await startDesignDeviance(db, projectId, triggeredBy)
  return started.ok ? started.execute() : started
}

/**
 * Insert the `running` gate run and return the work as `execute`, so a
 * request can answer 202 at once and finish the scan in the background.
 */
export async function startDesignDeviance(db: Db, projectId: string, triggeredBy = 'manual'): Promise<DevianceStart> {
  const snapshot = await loadCurrentSnapshot(db, projectId)
  if (!snapshot?.manifest || !judgingSet(snapshot.tokens)) {
    return { ok: false, error: 'No design tokens to judge against. Add mushi.recipe.json with DTCG token files and refresh.' }
  }
  const resolved = await resolveRecipeRepo(db, projectId)
  if (!resolved.ok) return { ok: false, error: resolved.reason }
  const repo: RecipeRepo = resolved.repo
  const startedAt = new Date().toISOString()
  const { data: runRow, error: runErr } = await db
    .from('gate_runs')
    .insert({ project_id: projectId, gate: DESIGN_GATE, status: 'running', commit_sha: snapshot.commit_sha, triggered_by: triggeredBy, summary: { phase: 'scan' }, started_at: startedAt })
    .select('id')
    .single()
  if (runErr) throw new Error(`gate_runs insert failed: ${runErr.message}`)
  const runId = (runRow as { id: string }).id
  return { ok: true, runId, startedAt, commitSha: snapshot.commit_sha, execute: () => executeScan(db, projectId, snapshot, repo, runId, startedAt) }
}

/** Store a scan's findings (capped) in the shape loadRunFindings reads; returns the stored count. Throws on a failed insert. */
export async function storeScanFindings(db: Db, projectId: string, runId: string, findings: readonly DevianceFinding[]): Promise<number> {
  const stored = findings.slice(0, SCAN_LIMITS.maxStoredFindings)
  const rows = stored.map((f) => ({
    gate_run_id: runId,
    project_id: projectId,
    severity: f.severity,
    rule_id: f.rule_id,
    message: f.message.slice(0, 500),
    file_path: f.file_path,
    line: f.line,
    col: f.col,
    suggested_fix: { value: f.value, suggestion: f.suggestion },
  }))
  for (let i = 0; i < rows.length; i += 250) {
    const { error } = await db.from('gate_findings').insert(rows.slice(i, i + 250))
    if (error) throw new Error(`gate_findings insert failed: ${error.message}`)
  }
  return stored.length
}

/** The `design.deviance_score` metric point for a scored run (the set is the dimension). */
export async function recordDevianceMetric(db: Db, projectId: string, set: string | null, ts: string, score: number | null): Promise<void> {
  if (score == null) return
  const { error } = await db.from('metric_series').insert({ project_id: projectId, metric_name: DEVIANCE_METRIC, dimension: set, ts, value: score })
  if (error) dlog.error('deviance metric insert failed', { projectId, err: error.message })
}

async function executeScan(db: Db, projectId: string, snapshot: SnapshotRow, repo: RecipeRepo, runId: string, startedAt: string): Promise<{ ok: true; run: DevianceRun } | { ok: false; error: string }> {
  try {
    const sha = snapshot.commit_sha ?? (await getDefaultHead(repo)).sha
    const tree = await listTree(repo, sha)
    const pick = selectScanFiles(tree.entries, snapshot.manifest, [...tokenFilePaths(snapshot.tokens), RECIPE_MANIFEST_PATH])
    const texts = await readBlobsGraphql(repo, sha, pick.files)
    const result = computeDeviance(snapshot, texts)
    const scannedFiles = result.scannedFiles
    const status = devianceStatus(result.findings)
    const stored = await storeScanFindings(db, projectId, runId, result.findings)
    // Opt-in actions (off by default): may dispatch a fix for new findings. Never throws.
    const acted = await actOnDesignDeviance(db, { projectId, runId, score: result.score, findings: result.findings, branch: null })
    if (acted.action !== 'off') dlog.info('design deviance action', { projectId, runId, ...acted })
    const completedAt = new Date().toISOString()
    const summary = {
      phase: 'scan',
      score: result.score,
      breakdown: result.breakdown,
      counts: result.counts,
      scannedFiles,
      scannedLines: result.scannedLines,
      matchedFiles: pick.matched,
      truncated: pick.truncated || tree.truncated,
      storedFindings: stored,
      snapshotId: snapshot.id,
      tokensHash: snapshot.tokens_hash,
      set: judgingSet(snapshot.tokens)?.name ?? null,
      ...(acted.action === 'off' ? {} : { action: acted }),
    }
    const { error: upErr } = await db
      .from('gate_runs')
      .update({ status, summary, findings_count: result.findings.length, completed_at: completedAt })
      .eq('id', runId)
    if (upErr) throw new Error(`gate_runs update failed: ${upErr.message}`)
    await recordDevianceMetric(db, projectId, summary.set, completedAt, result.score)
    const run: DevianceRun = {
      runId,
      status,
      score: result.score,
      scannedFiles,
      scannedLines: result.scannedLines,
      matchedFiles: pick.matched,
      truncated: summary.truncated,
      commitSha: sha,
      startedAt,
      completedAt,
      breakdown: result.breakdown,
      counts: result.counts,
      storedFindings: stored,
      error: null,
    }
    return { ok: true, run }
  } catch (err) {
    const message = (err as Error)?.message ?? String(err)
    await db
      .from('gate_runs')
      .update({ status: 'error', summary: { phase: 'scan', error: message.slice(0, 500) }, completed_at: new Date().toISOString() })
      .eq('id', runId)
    dlog.warn('design deviance run failed', { projectId, message })
    return { ok: false, error: message }
  }
}
