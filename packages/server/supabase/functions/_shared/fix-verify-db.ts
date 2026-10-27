/**
 * FILE: packages/server/supabase/functions/_shared/fix-verify-db.ts
 * PURPOSE: Verified fixes (ADR 0035): the reads and writes of
 *          `fix_merge_gates`, `fix_regressions`, the verify settings and
 *          `fix_attempts.regressed_at`, shared by the fix-verifier worker, the
 *          merge paths (gated-merge records the merged head), the verify
 *          routes, the fix timeline and MCP get_fix_verification.
 *
 * Every read tolerates the tables not existing yet (before the migration):
 * display reads show "not verified", the worker does nothing.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { canonicalPrUrl, parsePullRequestUrl } from './pr-substance.ts'
import { resolveLlmKey, type ResolvedKey } from './byok.ts'
import { isOpenRouterBaseUrl } from './openai-model-id.ts'
import {
  FIX_REGRESSION_COLUMNS,
  FIX_VERIFICATION_COLUMNS,
  pickVerificationRow,
  toPublicVerification,
  utcDayStart,
  SECOND_JUDGE_DEFAULT_MODEL,
  VERIFY_CLAIM_STALE_MS,
  VERIFY_SETTINGS_COLUMNS,
  VERIFY_SETTINGS_DEFAULTS,
  verifySettingsFromRow,
  type FixRegressionRow,
  type FixVerificationRow,
  type PublicFixVerification,
  type RegressionSignal,
  type SecondJudgeChoice,
  type VerifySettings,
} from './fix-verify.ts'

/** PostgREST / Postgres codes for "table or column not there yet". */
const NOT_MIGRATED = new Set(['42P01', 'PGRST205', '42703', 'PGRST204'])

export function notMigrated(err: { code?: string } | null | undefined): boolean {
  return NOT_MIGRATED.has(String(err?.code ?? ''))
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

export interface VerifySettingsRead {
  settings: VerifySettings
  /** False before the migration: the console shows the card as not available yet. */
  available: boolean
  error: string | null
}

export async function loadVerifySettings(db: SupabaseClient, projectId: string): Promise<VerifySettingsRead> {
  const { data, error } = await db.from('project_settings').select(VERIFY_SETTINGS_COLUMNS).eq('project_id', projectId).maybeSingle()
  if (error) {
    if (notMigrated(error as { code?: string })) return { settings: { ...VERIFY_SETTINGS_DEFAULTS }, available: false, error: null }
    return { settings: { ...VERIFY_SETTINGS_DEFAULTS }, available: true, error: error.message }
  }
  return { settings: verifySettingsFromRow(data as Record<string, unknown> | null), available: true, error: null }
}

/** Write a validated column patch; creates the project_settings row when the app has none. */
export async function saveVerifySettings(
  db: SupabaseClient,
  projectId: string,
  columns: Record<string, unknown>,
): Promise<{ settings: VerifySettings | null; error: string | null; code?: string }> {
  const { data, error } = await db
    .from('project_settings')
    .update(columns)
    .eq('project_id', projectId)
    .select(VERIFY_SETTINGS_COLUMNS)
  if (error) return { settings: null, error: error.message, code: (error as { code?: string }).code }
  if (Array.isArray(data) && data.length > 0) return { settings: verifySettingsFromRow(data[0] as unknown as Record<string, unknown>), error: null }
  const inserted = await db
    .from('project_settings')
    .insert({ project_id: projectId, ...columns })
    .select(VERIFY_SETTINGS_COLUMNS)
    .maybeSingle()
  if (inserted.error) return { settings: null, error: inserted.error.message, code: (inserted.error as { code?: string }).code }
  return { settings: verifySettingsFromRow(inserted.data as Record<string, unknown> | null), error: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// The second-family judge's key (ADR 0023/0031 order, never the platform key)
// ─────────────────────────────────────────────────────────────────────────────

export type SecondJudgeKey =
  | { key: ResolvedKey; provider: 'openai' | 'openrouter'; model: string }
  | { key: null; reason: 'off' | 'no_key' | 'budget' }

/**
 * The key the second review runs on. `auto`: the app's OpenAI keys, then its
 * OpenRouter keys, through the resolver's order (own, legacy, organization,
 * owners' universal keys). `openai` / `openrouter`: that provider only. A
 * platform (env) key is never used: no key of the app's own means
 * "unavailable", which blocks automatic merge. `purpose: 'probe'` (the
 * settings card) skips the monthly budget check.
 */
export async function resolveSecondJudgeKey(
  db: SupabaseClient,
  projectId: string,
  settings: Pick<VerifySettings, 'verifySecondJudge' | 'verifySecondJudgeModel'>,
  opts: { purpose?: 'generation' | 'probe' } = {},
): Promise<SecondJudgeKey> {
  const choice: SecondJudgeChoice = settings.verifySecondJudge
  if (choice === 'off') return { key: null, reason: 'off' }
  const purpose = opts.purpose ?? 'generation'
  let key: ResolvedKey | null
  try {
    key = choice === 'openrouter'
      ? await resolveLlmKey(db, projectId, 'openrouter', { purpose })
      : await resolveLlmKey(db, projectId, 'openai', { purpose, openAiOnly: choice === 'openai' })
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'LlmBudgetExceededError') return { key: null, reason: 'budget' }
    throw err
  }
  if (!key || key.source !== 'byok') return { key: null, reason: 'no_key' }
  const provider = key.provider === 'openrouter' || isOpenRouterBaseUrl(key.baseUrl) ? 'openrouter' : 'openai'
  return { key, provider, model: settings.verifySecondJudgeModel ?? SECOND_JUDGE_DEFAULT_MODEL[provider] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a fix's verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The verification callers show for one fix attempt: the merged head, else
 * `currentHead` (fix_attempts.commit_sha follows the PR head), else the newest
 * evaluation; plus every regression signal. Null when the fix has never been
 * checked (no row, no regression). Never throws; a failed read is null too
 * (display only: the worker and the merge decide on their own reads).
 */
export async function loadFixVerification(db: SupabaseClient, fixAttemptId: string, currentHead: string | null): Promise<PublicFixVerification | null> {
  try {
    const [rows, regressions] = await Promise.all([
      db.from('fix_merge_gates').select(FIX_VERIFICATION_COLUMNS).eq('fix_attempt_id', fixAttemptId).order('evaluated_at', { ascending: false }).limit(20),
      db.from('fix_regressions').select(FIX_REGRESSION_COLUMNS).eq('fix_attempt_id', fixAttemptId).order('created_at', { ascending: true }).limit(10),
    ])
    const list = rows.error ? [] : ((rows.data ?? []) as FixVerificationRow[])
    const regs = regressions.error ? [] : ((regressions.data ?? []) as FixRegressionRow[])
    const row = pickVerificationRow(list, currentHead)
    if (!row && regs.length === 0) return null
    return toPublicVerification(row, regs, currentHead)
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Merges made through Mushi
// ─────────────────────────────────────────────────────────────────────────────

export interface MergedHeadTarget {
  id: string
  project_id: string
  report_id: string | null
  pr_url: string | null
  pr_number?: number | null
}

/**
 * Record which head a Mushi merge landed and its merge commit, so the
 * regression watch finds `merge_sha` (ADR 0035). Called by gated-merge for
 * every merge it makes (a person's from any merge route, or the worker's).
 * Updates the row for that head; a head merged before it was ever verified
 * gets a row with no gates. Never throws: the merge already happened.
 */
export async function recordMergedHead(
  db: SupabaseClient,
  attempt: MergedHeadTarget,
  merge: { headSha: string; mergeSha: string; mergedAt: string },
): Promise<{ recorded: boolean; error?: string }> {
  try {
    const now = new Date().toISOString()
    const { data, error } = await db
      .from('fix_merge_gates')
      .update({ merged_at: merge.mergedAt, merge_sha: merge.mergeSha, updated_at: now })
      .eq('fix_attempt_id', attempt.id)
      .eq('head_sha', merge.headSha)
      .is('merge_sha', null)
      .select('id')
    if (error) return { recorded: false, error: error.message }
    if (Array.isArray(data) && data.length > 0) return { recorded: true }
    const pr = parsePullRequestUrl(canonicalPrUrl(attempt.pr_url) ?? '')
    const { error: insertErr } = await db.from('fix_merge_gates').upsert(
      {
        fix_attempt_id: attempt.id,
        project_id: attempt.project_id,
        report_id: attempt.report_id,
        repo: pr ? `${pr.owner}/${pr.repo}`.toLowerCase() : null,
        pr_number: pr?.number ?? attempt.pr_number ?? null,
        head_sha: merge.headSha,
        gates: [],
        passed: false,
        merged_at: merge.mergedAt,
        merge_sha: merge.mergeSha,
        evaluated_at: now,
      },
      { onConflict: 'fix_attempt_id,head_sha', ignoreDuplicates: true },
    )
    return insertErr ? { recorded: false, error: insertErr.message } : { recorded: true }
  } catch (err) {
    return { recorded: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Automatic verified merges of one app since the start of today (UTC). Throws on a failed read: the cap fails closed. */
export async function countAutoMergesToday(db: SupabaseClient, projectId: string, now: Date): Promise<number> {
  const { count, error } = await db
    .from('fix_merge_gates')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('auto_merge_state', 'merged')
    .gte('merged_at', utcDayStart(now))
  if (error) throw new Error(`auto-merge count failed: ${error.message}`)
  return count ?? 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker: claim and write one (attempt, head) row
// ─────────────────────────────────────────────────────────────────────────────

export interface VerificationTarget {
  fixAttemptId: string
  projectId: string
  reportId: string | null
  repo: string | null
  prNumber: number | null
  headSha: string
}

export type ClaimResult =
  | { claimed: true; row: FixVerificationRow & { run_id: string } }
  | { claimed: false; reason: 'busy' | 'merged' | 'error'; error?: string }

/**
 * Claim the row for (attempt, head) for one run: insert it, or take it over
 * when no live run holds it (claimed_at older than 5 minutes, or released).
 * Every later write of the run is guarded on `run_id`.
 */
export async function claimVerification(db: SupabaseClient, target: VerificationTarget, runId: string, now: Date): Promise<ClaimResult> {
  const nowIso = now.toISOString()
  const staleIso = new Date(now.getTime() - VERIFY_CLAIM_STALE_MS).toISOString()
  const { data: inserted, error: insertErr } = await db
    .from('fix_merge_gates')
    .upsert(
      {
        fix_attempt_id: target.fixAttemptId,
        project_id: target.projectId,
        report_id: target.reportId,
        repo: target.repo,
        pr_number: target.prNumber,
        head_sha: target.headSha,
        gates: [],
        passed: false,
        run_id: runId,
        claimed_at: nowIso,
        evaluated_at: nowIso,
      },
      { onConflict: 'fix_attempt_id,head_sha', ignoreDuplicates: true },
    )
    .select(`${FIX_VERIFICATION_COLUMNS}, run_id`)
  if (insertErr) return { claimed: false, reason: 'error', error: insertErr.message }
  if (Array.isArray(inserted) && inserted.length > 0) {
    return { claimed: true, row: inserted[0] as FixVerificationRow & { run_id: string } }
  }
  const { data: taken, error: takeErr } = await db
    .from('fix_merge_gates')
    .update({ run_id: runId, claimed_at: nowIso, updated_at: nowIso })
    .eq('fix_attempt_id', target.fixAttemptId)
    .eq('head_sha', target.headSha)
    .neq('auto_merge_state', 'merged')
    .or(`run_id.is.null,claimed_at.is.null,claimed_at.lt.${staleIso}`)
    .select(`${FIX_VERIFICATION_COLUMNS}, run_id`)
  if (takeErr) return { claimed: false, reason: 'error', error: takeErr.message }
  if (Array.isArray(taken) && taken.length > 0) return { claimed: true, row: taken[0] as FixVerificationRow & { run_id: string } }
  const { data: existing } = await db
    .from('fix_merge_gates')
    .select('auto_merge_state')
    .eq('fix_attempt_id', target.fixAttemptId)
    .eq('head_sha', target.headSha)
    .maybeSingle()
  return { claimed: false, reason: (existing as { auto_merge_state?: string } | null)?.auto_merge_state === 'merged' ? 'merged' : 'busy' }
}

/** One guarded write of a run. True when this run still owned the row. */
export async function writeOwnVerification(
  db: SupabaseClient,
  rowId: string,
  runId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await db
    .from('fix_merge_gates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', rowId)
    .eq('run_id', runId)
    .select('id')
  if (error) throw new Error(`verification write failed: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline events and regressions
// ─────────────────────────────────────────────────────────────────────────────

export type VerifyEventKind = 'verified' | 'auto_merged' | 'regressed' | 'revert_opened'

export async function insertVerifyEvent(
  db: SupabaseClient,
  target: { fixAttemptId: string; projectId: string },
  ev: { kind: VerifyEventKind; status: 'ok' | 'fail' | 'pending'; label: string; detail: string | null; dedupe: string; payload: Record<string, unknown>; at?: string },
): Promise<void> {
  const { error } = await db.from('fix_events').insert({
    fix_attempt_id: target.fixAttemptId,
    project_id: target.projectId,
    kind: ev.kind,
    status: ev.status,
    label: ev.label,
    detail: ev.detail ? ev.detail.slice(0, 500) : null,
    at: ev.at ?? new Date().toISOString(),
    dedupe_key: ev.dedupe,
    payload: ev.payload,
  })
  // 23505: the event is already on the timeline (dedupe_key).
  if (error && (error as { code?: string }).code !== '23505') throw new Error(`fix_events insert failed: ${error.message}`)
}

/** Insert one regression signal; false when the signal was already recorded for the attempt. */
export async function insertRegression(
  db: SupabaseClient,
  row: { fixAttemptId: string; projectId: string; mergeSha: string; signal: RegressionSignal; detail: string | null; evidence: Record<string, unknown> | null },
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from('fix_regressions')
    .upsert(
      {
        fix_attempt_id: row.fixAttemptId,
        project_id: row.projectId,
        merge_sha: row.mergeSha,
        signal: row.signal,
        detail: row.detail ? row.detail.slice(0, 500) : null,
        evidence: row.evidence,
        revert_state: 'none',
      },
      { onConflict: 'fix_attempt_id,signal', ignoreDuplicates: true },
    )
    .select('id')
  if (error) throw new Error(`fix_regressions insert failed: ${error.message}`)
  return Array.isArray(data) && data.length > 0 ? (data[0] as { id: string }) : null
}

export async function setRevertState(
  db: SupabaseClient,
  regressionId: string,
  state: 'none' | 'pr_opened' | 'not_safe' | 'off' | 'failed',
  revertPrUrl: string | null,
  /** Why no revert PR was opened; kept beside the signal's own evidence. */
  why?: { detail: string; evidence: Record<string, unknown> | null },
): Promise<void> {
  const patch: Record<string, unknown> = { revert_state: state, revert_pr_url: revertPrUrl }
  if (why) patch.evidence = { ...(why.evidence ?? {}), revert: why.detail }
  const { error } = await db.from('fix_regressions').update(patch).eq('id', regressionId)
  if (error) throw new Error(`fix_regressions update failed: ${error.message}`)
}

/** Stamp fix_attempts.regressed_at once (the first regressing signal). */
export async function markRegressed(db: SupabaseClient, fixAttemptId: string, at: string): Promise<boolean> {
  const { data, error } = await db.from('fix_attempts').update({ regressed_at: at }).eq('id', fixAttemptId).is('regressed_at', null).select('id')
  if (error) throw new Error(`regressed_at update failed: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Repos
// ─────────────────────────────────────────────────────────────────────────────

export interface PrimaryRepo {
  owner: string
  repo: string
  defaultBranch: string | null
  installationId: number | null
}

const REPO_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i

/** The project's primary GitHub repo (project_repos.is_primary, then the legacy settings URL). */
export async function primaryRepoFor(db: SupabaseClient, projectId: string): Promise<PrimaryRepo | null> {
  const { data: repos } = await db
    .from('project_repos')
    .select('repo_url, is_primary, default_branch, github_app_installation_id')
    .eq('project_id', projectId)
    .order('is_primary', { ascending: false })
    .limit(10)
  const rows = (repos ?? []) as Array<{ repo_url: string | null; is_primary: boolean | null; default_branch: string | null; github_app_installation_id: unknown }>
  const pick = rows.find((r) => r.is_primary) ?? rows[0] ?? null
  const url = pick?.repo_url ?? null
  let m = url ? REPO_URL_RE.exec(url.trim()) : null
  if (!m) {
    const { data: settings } = await db.from('project_settings').select('github_repo_url').eq('project_id', projectId).maybeSingle()
    const legacy = (settings as { github_repo_url?: string | null } | null)?.github_repo_url ?? null
    m = legacy ? REPO_URL_RE.exec(legacy.trim()) : null
    if (!m) return null
    return { owner: m[1], repo: m[2], defaultBranch: null, installationId: null }
  }
  const installation = Number(pick?.github_app_installation_id)
  return {
    owner: m[1],
    repo: m[2],
    defaultBranch: pick?.default_branch ?? null,
    installationId: Number.isFinite(installation) && installation > 0 ? installation : null,
  }
}
