/**
 * FILE: packages/server/supabase/functions/_shared/design-plane.ts
 * PURPOSE: The I/O half of the design plane (Plan 019 Phase 1b):
 *   - refreshRecipeSnapshot: read mushi.recipe.json and its DTCG token files
 *     from the project's repo at the default-branch head, normalize them, and
 *     store an `app_recipe_snapshots` row;
 *   - runDesignDeviance: scan the repo's source at the snapshot's commit
 *     (bounded) and write a `design_drift` gate run, its findings, and the
 *     `design.deviance_score` metric.
 *
 * Failures are written down, not swallowed: a failed refresh or scan leaves a
 * `design_drift` gate run with status `error`, so the console renders `error`
 * instead of an old `ok` (the fail-open lesson, repo memory).
 */

import type { getServiceClient } from './db.ts'
import { log } from './logger.ts'
import { normalizeTokenSet, stableStringify } from './dtcg.ts'
import {
  buildDevianceContext,
  computeDevianceScore,
  contrastFindings,
  devianceStatus,
  evaluateContrast,
  LITERAL_RULES,
  ruleApplicable,
  scanSourceFile,
  sortFindings,
} from './design-deviance.ts'
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
} from './recipe-github.ts'
import { effectiveDesignRules, parseRecipeManifest, RECIPE_MANIFEST_MAX_BYTES, RECIPE_MANIFEST_PATH, type RecipeManifest } from './recipe-schema.ts'
import { scanForSecrets } from './secret-scan.ts'
import type {
  DesignComponentEntry,
  DesignRuleId,
  DevianceFinding,
  DevianceRun,
  RecipeIssue,
  RecipeRefreshResult,
} from './recipe-types.ts'

type Db = ReturnType<typeof getServiceClient>
const dlog = log.child('design-plane')

export const DESIGN_GATE = 'design_drift'
export const DEVIANCE_METRIC = 'design.deviance_score'
/** Scan bounds: files, total bytes, bytes per file, stored finding rows. */
export const SCAN_LIMITS = { maxFiles: 1500, maxBytes: 12 * 1024 * 1024, maxFileBytes: 256 * 1024, maxStoredFindings: 500 }
export const DEFAULT_SCAN_GLOBS = ['**/*.{css,scss,ts,tsx,js,jsx}']
export const ALWAYS_IGNORE = [
  '**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/out/**', '**/coverage/**', '**/vendor/**',
  '**/*.d.ts', '**/*.min.*', '**/*.map', '**/*.generated.*', '**/android/**', '**/ios/**',
]

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

export async function refreshRecipeSnapshot(db: Db, projectId: string, triggeredBy = 'manual'): Promise<RecipeRefreshResult> {
  const fail = async (reason: string, state: RecipeRefreshResult['state'] = 'error'): Promise<RecipeRefreshResult> => {
    if (state === 'error') await recordDesignError(db, projectId, 'refresh', reason, null, triggeredBy)
    return { ok: false, state, reason, snapshotId: null, tokensHash: null, manifestPresent: false, tokenCount: 0, issues: [] }
  }
  let resolved
  try {
    resolved = await resolveRecipeRepo(db, projectId)
  } catch (err) {
    return fail(String((err as Error).message ?? err))
  }
  if (!resolved.ok) return fail(resolved.reason, 'not_connected')
  const repo = resolved.repo
  try {
    const head = await getDefaultHead(repo)
    const manifestFile = await readRepoFile(repo, head.sha, RECIPE_MANIFEST_PATH, RECIPE_MANIFEST_MAX_BYTES)
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
      const tree = await listTree(repo, head.sha).catch((err) => {
        issues.push(issue('TREE_UNAVAILABLE', `Could not list the repo tree, so sibling directions and components are skipped: ${String((err as Error).message ?? err)}`, 'warn'))
        return { entries: [], truncated: false }
      })
      if (tree.truncated) issues.push(issue('TREE_TRUNCATED', 'GitHub truncated the repo tree; some directions or components may be missing.', 'warn'))
      const paths = tree.entries.map((e) => e.path)
      const plan = planTokenSets((manifest.design?.tokens ?? []) as Array<{ path: string; role: 'source' | 'export'; generator?: string }>, paths)
      issues.push(...plan.issues)
      const sets: StoredTokenSet[] = []
      for (const set of plan.sets) {
        const files = []
        for (const f of set.files) {
          const file = await readRepoFile(repo, head.sha, f.path, MAX_TOKEN_FILE_BYTES)
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
      stored = { version: 1, active: sets.find((s) => s.active)?.name ?? null, sets }
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
          source: 'repo_file',
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

/** Files the scan reads, in a fixed order, plus whether a cap cut it short. */
export function selectScanFiles(
  entries: ReadonlyArray<{ path: string; size: number }>,
  manifest: RecipeManifest | null,
  excludePaths: readonly string[],
  limits = SCAN_LIMITS,
): { files: string[]; matched: number; truncated: boolean } {
  const globs = manifest?.design?.literalScan?.globs?.length ? manifest.design.literalScan.globs : DEFAULT_SCAN_GLOBS
  const ignore = [...ALWAYS_IGNORE, ...(manifest?.design?.literalScan?.ignore ?? [])]
  const matched = entries
    .filter((e) => matchAny(e.path, globs) && !matchAny(e.path, ignore) && !excludePaths.includes(e.path) && e.size <= limits.maxFileBytes)
    .sort((a, b) => (a.path < b.path ? -1 : 1))
  const files: string[] = []
  let bytes = 0
  for (const e of matched) {
    if (files.length >= limits.maxFiles || bytes + e.size > limits.maxBytes) break
    files.push(e.path)
    bytes += e.size
  }
  return { files, matched: matched.length, truncated: files.length < matched.length }
}

export interface DevianceComputation {
  findings: DevianceFinding[]
  counts: Partial<Record<DesignRuleId, number>>
  score: number | null
  breakdown: ReturnType<typeof computeDevianceScore>['breakdown']
  scannedLines: number
}

/** Pure: everything a deviance run computes from the snapshot plus file texts. */
export function computeDeviance(snapshot: Pick<SnapshotRow, 'manifest' | 'tokens'>, texts: ReadonlyMap<string, string | null>): DevianceComputation {
  const set = judgingSet(snapshot.tokens)
  const tokens = set?.tokens ?? []
  const rules = effectiveDesignRules(snapshot.manifest)
  const ctx = buildDevianceContext(tokens, rules, snapshot.manifest?.design?.components?.globs ?? [])
  const findings: DevianceFinding[] = []
  let scannedLines = 0
  let scannedFiles = 0
  for (const [path, text] of texts) {
    if (text == null) continue
    const r = scanSourceFile(path, text, ctx)
    scannedLines += r.lines
    scannedFiles++
    findings.push(...r.findings)
  }
  const contrast = evaluateContrast(tokens, snapshot.manifest?.design?.contrast ?? [])
  findings.push(...contrastFindings(contrast, tokens, rules.find((r) => r.id === 'contrast_below_aa')))
  const counts: Partial<Record<DesignRuleId, number>> = {}
  for (const f of findings) counts[f.rule_id] = (counts[f.rule_id] ?? 0) + 1
  const judged = contrast.filter((c) => c.pass !== null)
  const applicable: Partial<Record<DesignRuleId, boolean>> = {}
  for (const r of [...LITERAL_RULES, 'contrast_below_aa' as const]) applicable[r] = ruleApplicable(r, ctx, judged.length)
  const { score, breakdown } = computeDevianceScore({
    rules,
    counts,
    scannedLines,
    scannedFiles,
    applicable,
    contrast: { declared: judged.length, failing: judged.filter((c) => c.pass === false).length },
  })
  return { findings: sortFindings(findings), counts, score, breakdown, scannedLines }
}

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

async function executeScan(db: Db, projectId: string, snapshot: SnapshotRow, repo: RecipeRepo, runId: string, startedAt: string): Promise<{ ok: true; run: DevianceRun } | { ok: false; error: string }> {
  try {
    const sha = snapshot.commit_sha ?? (await getDefaultHead(repo)).sha
    const tree = await listTree(repo, sha)
    const tokenFiles = (snapshot.tokens?.sets ?? []).flatMap((s) => s.files.map((f) => f.path))
    const pick = selectScanFiles(tree.entries, snapshot.manifest, [...tokenFiles, RECIPE_MANIFEST_PATH])
    const texts = await readBlobsGraphql(repo, sha, pick.files)
    const result = computeDeviance(snapshot, texts)
    const scannedFiles = [...texts.values()].filter((t) => t != null).length
    const status = devianceStatus(result.findings)
    const stored = result.findings.slice(0, SCAN_LIMITS.maxStoredFindings)
    if (stored.length > 0) {
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
    }
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
      storedFindings: stored.length,
      snapshotId: snapshot.id,
      tokensHash: snapshot.tokens_hash,
      set: judgingSet(snapshot.tokens)?.name ?? null,
    }
    const { error: upErr } = await db
      .from('gate_runs')
      .update({ status, summary, findings_count: result.findings.length, completed_at: completedAt })
      .eq('id', runId)
    if (upErr) throw new Error(`gate_runs update failed: ${upErr.message}`)
    if (result.score != null) {
      const { error: mErr } = await db.from('metric_series').insert({ project_id: projectId, metric_name: DEVIANCE_METRIC, dimension: summary.set, ts: completedAt, value: result.score })
      if (mErr) dlog.error('deviance metric insert failed', { projectId, err: mErr.message })
    }
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
      storedFindings: stored.length,
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
