// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * review-followup — Supabase Edge Function (verify_jwt = false, internal)
 *
 * The review follow-up loop (ADR 0032). When the Opus review of a cloud
 * agent's PR (ADR 0030) says "fix_first" on the PR's current head, Mushi
 * starts one NEW Cursor agent on that PR with the review's findings; the
 * push is then reviewed again. When the review says "merge" but CI on that
 * head fails on the code (ci_jobs, not an infra stop: ADR 0033), the same
 * loop sends one CI-repair agent with the failing check names and a
 * screened log excerpt (ADR 0032 amendment, 2026-10-22). Each tick:
 *
 *   1. settles: a follow-up that pushed gets the verdict of the review of
 *      its new head once that review completes (`verdict_after`);
 *   2. discovers: completed fix_first reviews (and merge reviews whose head
 *      fails CI on the code) of the last 3 days that have
 *      no follow-up for their head are queued (agent-pr-review also queues
 *      one the moment the verdict lands; the unique (attempt, head) keeps
 *      it to one). At most one per (fix attempt, reviewed head) and two per
 *      PR; never on hold or merge; never on a closed or merged PR;
 *   3. dispatches up to 5 queued follow-ups (at most 2 per app). Each is
 *      claimed with a fresh `run_id`; every later write of the tick is
 *      guarded on it. It is skipped for good when the review changed, the PR
 *      moved, closed or merged, the per-PR limit is used, follow-ups are off
 *      for the organization or auto-fix is off for the app. It waits (stays
 *      queued with the reason, skipped as expired after a day) while another
 *      follow-up on the PR runs, the organization's daily limit or the app's
 *      auto-fix caps are reached (`checkAutofixBudget`, trigger automatic:
 *      the same caps every automatic dispatch obeys), no Cursor key resolves,
 *      or the model is not in the key's GET /v1/models list (read at most
 *      once an hour per key; unlisted fails closed). The spend-down stop-loss
 *      does not apply: follow-ups are its remedy. Then POST /v1/agents with
 *      `repos: [{ url, prUrl }]`, `workOnCurrentBranch: true`,
 *      `autoCreatePR: false` and the model, under a deterministic agent id
 *      (a retried create answers 409 agent_id_conflict and the agent is
 *      adopted; 409 agent_busy waits a tick);
 *   4. polls dispatched and running agents (`getCursorRun`). On a finished
 *      run it reads the PR head from GitHub: a moved head is "Follow-up
 *      pushed" and the review is re-queued with force (the
 *      pull_request.synchronize webhook may be missing); an unmoved head is
 *      "Follow-up made no change" (the agent's final message says why). A
 *      run that has not finished after 6 hours is marked failed.
 *
 * Every step adds a `followup` fix event. Nothing here merges.
 *
 * Cursor API: https://cursor.com/docs/cloud-agent/api/endpoints (verified
 * 2026-10-21). A follow-up run on the original agent cannot switch model and
 * bills the account that created it, so a follow-up is always a new agent.
 *
 * Auth: `requireServiceRoleAuth`. Invoked by pg_cron `mushi-review-followup`
 * (migration 20261021063310, `6-56/10 * * * *`).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import { sanitizeForLLM } from '../_shared/sanitize.ts'
import { checkAutofixBudget, type AutofixBudgetCheck, type AutofixBudgetSettings } from '../_shared/autofix-budget.ts'
import {
  fetchPullRequestDetails,
  fetchPullRequestFiles,
  installationIdForAttempt,
  resolveProjectGithubToken,
  type GithubRepoRef,
  type PullRequestDetails,
  type PullRequestFile,
} from '../_shared/github.ts'
import { parsePullRequestUrl } from '../_shared/pr-substance.ts'
import { readFixCiInfra } from '../_shared/ci-infra.ts'
import { ciGithub, fetchJobLogTail } from '../_shared/ci-jobs.ts'
import { enqueueFixReview } from '../_shared/fix-review-db.ts'
import {
  cancelCursorRun,
  createCursorAgentV1,
  CursorApiError,
  deterministicCursorAgentId,
  getCursorAgent,
  getCursorRun,
  listCursorModelsV1,
  type CreateCursorAgentV1Input,
  type CursorAgent,
  type CursorCreateAgentResponse,
  type CursorModelInfo,
  type CursorRun,
} from '../_shared/cursor-cloud.ts'
import {
  buildCiRepairPrompt,
  buildFollowupPrompt,
  CI_REPAIR_MAX_CHECKS,
  CI_REPAIR_MAX_EXCERPTS,
  ciHeadState,
  extractCiLogExcerpt,
  cursorBackoffMs,
  expireIfStale,
  FOLLOWUP_CANCEL_GIVE_UP_MS,
  FOLLOWUP_CLAIM_STALE_MS,
  FOLLOWUP_DISCOVERY_WINDOW_MS,
  FOLLOWUP_REASONS,
  FOLLOWUP_RUN_TIMEOUT_MS,
  FOLLOWUP_VERDICT_WINDOW_MS,
  followupAgentInput,
  followupDispatchGate,
  followupTrigger,
  repoUrlFromPrUrl,
  screenFindings,
  validateCursorModel,
  type CiHeadState,
  type CiJobForRepair,
  type CiRepairCheck,
  type DispatchGate,
  type LivePr,
  type PrFilesForScreen,
  type FollowupFinding,
  type FollowupReason,
  type PriorFollowup,
} from '../_shared/review-followup.ts'
import {
  ciJobsForHeads,
  cursorKeyById,
  cursorModelsCached,
  enqueueReviewFollowup,
  loadFollowupSettings,
  orgFollowupsToday,
  PRIOR_COLUMNS,
  type FollowupKey,
  type FollowupSettings,
} from '../_shared/review-followup-db.ts'
import { resolveCursorApiKeyWithSource } from '../_shared/agent-adapters.ts'

const log = rootLog.child('review-followup')

/** Follow-ups dispatched per tick, and per app per tick. */
export const FOLLOWUP_BATCH = 5
export const FOLLOWUP_PER_PROJECT_PER_TICK = 2
/** Queued rows read per tick to fill the batch fairly. */
const QUEUE_SCAN = 40
/** Active agents polled per tick. */
const POLL_BATCH = 20
const DISCOVERY_SCAN = 200
const AGENT_RESULT_MAX = 2_000

const ROW_COLUMNS =
  'id, fix_review_id, fix_attempt_id, project_id, report_id, pr_url, head_sha_before, status, attempts, cursor_failures, queued_at, created_at, cursor_agent_id, cursor_run_id, key_id, key_kind, dispatched_at'
const ATTEMPT_COLUMNS = 'id, project_id, report_id, agent, branch_name, pr_url, pr_state, merged_at, repo_id, ci_infra'

export interface FollowupRow {
  id: string
  fix_review_id: string
  fix_attempt_id: string
  project_id: string
  report_id: string | null
  pr_url: string | null
  head_sha_before: string
  status: string
  attempts: number | null
  /** Cursor 5xx / 429 / network failures; the back-off counts these, not claims. */
  cursor_failures?: number | null
  queued_at: string
  created_at: string | null
  cursor_agent_id: string | null
  cursor_run_id: string | null
  key_id: string | null
  /** 'pool' (key_id) or 'legacy' (the app's Integrations key); null before dispatch. */
  key_kind?: string | null
  dispatched_at: string | null
}

interface AttemptRow {
  id: string
  project_id: string
  report_id: string | null
  /** Only cloud-agent PRs (cursor_cloud, github_cloud_agent) get follow-ups. */
  agent: string | null
  /** The branch the agent created; the PR head must be exactly this branch. */
  branch_name: string | null
  pr_url: string | null
  pr_state: string | null
  merged_at: string | null
  repo_id: string | null
  /** CI verdict for the PR head (Plan 022): findings that only restate an infra stop are dropped. */
  ci_infra?: unknown
}

export interface FollowupDeps {
  now?: () => Date
  newRunId?: () => string
  resolveKey?: (db: SupabaseClient, args: { projectId: string; organizationId: string; keyId: string | null }) => Promise<FollowupKey>
  /** Polling: the key that started the run. */
  keyForRun?: (db: SupabaseClient, row: FollowupRow, organizationId: string) => Promise<FollowupKey>
  listModels?: (apiKey: string) => Promise<CursorModelInfo[]>
  createAgent?: (apiKey: string, input: CreateCursorAgentV1Input) => Promise<CursorCreateAgentResponse>
  getAgent?: (apiKey: string, agentId: string) => Promise<CursorAgent>
  getRun?: (apiKey: string, agentId: string, runId: string) => Promise<CursorRun>
  resolveGithubToken?: (db: SupabaseClient, attempt: AttemptRow) => Promise<string | null>
  fetchPr?: (token: string, ref: GithubRepoRef, n: number) => Promise<PullRequestDetails | null>
  /** The PR's changed files: a finding about any other file is not sent. */
  fetchFiles?: (token: string, ref: GithubRepoRef, n: number) => Promise<{ files: PullRequestFile[]; complete: boolean } | null>
  cancelRun?: (apiKey: string, agentId: string, runId: string) => Promise<unknown>
  /** The run's own key, scope not checked: only to cancel a run whose key stopped serving the app. */
  keyForCancel?: (db: SupabaseClient, row: FollowupRow, organizationId: string) => Promise<FollowupKey>
  checkBudget?: (db: SupabaseClient, projectId: string, settings: AutofixBudgetSettings) => Promise<AutofixBudgetCheck>
  enqueueReview?: typeof enqueueFixReview
  /** CI repair: the ci_jobs rows of one head (throws on a read error). */
  readCiJobs?: (db: SupabaseClient, projectId: string, headSha: string) => Promise<CiJobForRepair[]>
  /** CI repair: the tail of one job's log, or null when unreadable. */
  fetchJobLog?: (token: string, repo: string, jobId: number) => Promise<string | null>
}

export type FollowupOutcome =
  | { outcome: 'dispatched'; agentId: string }
  | { outcome: 'waiting' | 'skipped'; reason: FollowupReason }
  | { outcome: 'running' }
  | { outcome: 'pushed' | 'no_change' | 'head_unknown'; status: 'completed' | 'failed' }
  | { outcome: 'not_claimed' }
  | { outcome: 'superseded' }
  | { outcome: 'key_removed' }

export interface FollowupRunSummary {
  settled: number
  discovered: number
  dispatched: number
  waiting: number
  skipped: number
  polled: number
  pushed: number
  noChange: number
  timedOut: number
  results: Array<{ followupId: string } & FollowupOutcome>
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

async function defaultGithubToken(db: SupabaseClient, attempt: AttemptRow): Promise<string | null> {
  const installationId = await installationIdForAttempt(db, attempt)
  return resolveProjectGithubToken(db, attempt.project_id, installationId)
}

/**
 * The Cursor key a follow-up for one app runs on: the organization's chosen
 * key (`review_followup_key_id`; a universal key only when it serves this
 * app, ADR 0031), else the key the app's fixes use (the resolver: own pool
 * key, legacy Integrations key, shared key, the organization owners'
 * universal keys).
 */
export async function resolveFollowupKey(
  db: SupabaseClient,
  args: { projectId: string; organizationId: string; keyId: string | null },
): Promise<FollowupKey> {
  // A universal key must serve this app (ADR 0031), checked per dispatch.
  if (args.keyId) return cursorKeyById(db, args.keyId, args.organizationId, { projectId: args.projectId })
  const resolved = await resolveCursorApiKeyWithSource(db, args.projectId)
  if (!resolved) return { ok: false, reason: 'no_cursor_key' }
  // The env key is the platform's own Cursor account. The repo has no
  // self-host flag to tell a self-hoster's env key apart, so follow-ups never
  // spend it: an unbilled agent run per fix_first PR is not Mushi's to absorb.
  if (resolved.source === 'env') return { ok: false, reason: 'platform_key' }
  return {
    ok: true,
    apiKey: resolved.key,
    keyId: resolved.keyId,
    cacheKey: resolved.keyId ? `key:${resolved.keyId}` : `${resolved.source}:${args.projectId}`,
    source: resolved.keyId ? 'pool' : 'legacy',
  }
}

/**
 * The key that started the run, and only that key: the run is billed to it.
 * A pool key that was deleted (key_id set null by the foreign key) is gone:
 * `key_removed`, never a fallback to whichever key the resolver picks now.
 * A legacy Integrations key is read again from the app, and only accepted if
 * it is still the legacy key.
 */
async function defaultKeyForRun(db: SupabaseClient, row: FollowupRow, organizationId: string): Promise<FollowupKey> {
  if (row.key_id) return cursorKeyById(db, row.key_id, organizationId, { requireActive: false, projectId: row.project_id })
  if (row.key_kind !== 'legacy') return { ok: false, reason: 'key_removed' }
  const resolved = await resolveCursorApiKeyWithSource(db, row.project_id)
  if (!resolved || resolved.source !== 'legacy') return { ok: false, reason: 'key_removed' }
  return { ok: true, apiKey: resolved.key, keyId: null, cacheKey: `legacy:${row.project_id}`, source: 'legacy' }
}

function defaults(deps: FollowupDeps): Required<FollowupDeps> {
  return {
    now: deps.now ?? (() => new Date()),
    newRunId: deps.newRunId ?? (() => crypto.randomUUID()),
    resolveKey: deps.resolveKey ?? resolveFollowupKey,
    keyForRun: deps.keyForRun ?? defaultKeyForRun,
    listModels: deps.listModels ?? ((apiKey) => listCursorModelsV1({ apiKey })),
    createAgent: deps.createAgent ?? ((apiKey, input) => createCursorAgentV1({ apiKey }, input)),
    getAgent: deps.getAgent ?? ((apiKey, id) => getCursorAgent({ apiKey }, id)),
    getRun: deps.getRun ?? ((apiKey, agentId, runId) => getCursorRun({ apiKey }, agentId, runId)),
    resolveGithubToken: deps.resolveGithubToken ?? defaultGithubToken,
    fetchPr: deps.fetchPr ?? fetchPullRequestDetails,
    fetchFiles: deps.fetchFiles ?? fetchPullRequestFiles,
    cancelRun: deps.cancelRun ?? ((apiKey, agentId, runId) => cancelCursorRun({ apiKey }, agentId, runId)),
    keyForCancel:
      deps.keyForCancel ??
      ((db, row, org) =>
        row.key_id
          ? cursorKeyById(db, row.key_id, org, { requireActive: false, skipScopeCheck: true })
          : Promise.resolve({ ok: false, reason: 'key_removed' } as FollowupKey)),
    checkBudget:
      deps.checkBudget ?? ((d, pid, s) => checkAutofixBudget(d, pid, s, { trigger: 'automatic' })),
    enqueueReview: deps.enqueueReview ?? enqueueFixReview,
    readCiJobs:
      deps.readCiJobs ?? (async (d, pid, sha) => (await ciJobsForHeads(d, [pid], [sha])).get(sha) ?? []),
    fetchJobLog:
      deps.fetchJobLog ?? ((token, repo, jobId) => fetchJobLogTail(ciGithub(token, 1), repo, jobId)),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline events
// ─────────────────────────────────────────────────────────────────────────────

async function followupEvent(
  db: SupabaseClient,
  row: Pick<FollowupRow, 'id' | 'fix_attempt_id' | 'project_id'>,
  ev: { status: 'ok' | 'fail' | 'pending'; label: string; detail: string; dedupe: string; payload: Record<string, unknown>; at: string },
): Promise<void> {
  const { error } = await db.from('fix_events').insert({
    fix_attempt_id: row.fix_attempt_id,
    project_id: row.project_id,
    kind: 'followup',
    status: ev.status,
    label: ev.label,
    detail: ev.detail.slice(0, 500),
    at: ev.at,
    dedupe_key: ev.dedupe,
    payload: { followupId: row.id, ...ev.payload },
  })
  if (error && error.code !== '23505') log.warn('fix_events follow-up insert failed (non-fatal)', { followupId: row.id, err: error.message })
}

// ─────────────────────────────────────────────────────────────────────────────
// Claiming
// ─────────────────────────────────────────────────────────────────────────────

/** Take the row for this tick: only in the expected status, and only when no live tick holds it. */
async function claim(db: SupabaseClient, row: FollowupRow, runId: string, now: Date, extra: Record<string, unknown> = {}): Promise<boolean> {
  const staleIso = new Date(now.getTime() - FOLLOWUP_CLAIM_STALE_MS).toISOString()
  const { data, error } = await db
    .from('fix_review_followups')
    .update({ run_id: runId, claimed_at: now.toISOString(), updated_at: now.toISOString(), ...extra })
    .eq('id', row.id)
    .eq('status', row.status)
    .or(`claimed_at.is.null,claimed_at.lt.${staleIso}`)
    .select('id')
  return !error && Array.isArray(data) && data.length > 0
}

/** A write of this tick, guarded on its claim; it releases the claim. */
function ownWrite(db: SupabaseClient, rowId: string, runId: string, now: Date, patch: Record<string, unknown>) {
  return db
    .from('fix_review_followups')
    .update({ ...patch, run_id: null, claimed_at: null, updated_at: now.toISOString() })
    .eq('id', rowId)
    .eq('run_id', runId)
    .select('id')
}

async function written(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<boolean> {
  const { data, error } = await q
  return !error && Array.isArray(data) && data.length > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared reads
// ─────────────────────────────────────────────────────────────────────────────

async function readAttempt(db: SupabaseClient, id: string): Promise<AttemptRow | null> {
  const { data } = await db.from('fix_attempts').select(ATTEMPT_COLUMNS).eq('id', id).maybeSingle()
  return (data as AttemptRow | null) ?? null
}

/** The PR as GitHub sees it now, or null when it cannot be read. */
async function livePr(db: SupabaseClient, d: Required<FollowupDeps>, attempt: AttemptRow): Promise<LivePr | null> {
  const pr = attempt.pr_url ? parsePullRequestUrl(attempt.pr_url) : null
  if (!pr) return null
  try {
    const token = await d.resolveGithubToken(db, attempt)
    if (!token) return null
    const details = await d.fetchPr(token, { owner: pr.owner, repo: pr.repo }, pr.number)
    if (!details) return null
    return {
      open: details.state === 'open' && !details.merged,
      headSha: details.headSha ?? null,
      headRef: details.headRef ?? null,
      headRepoId: details.headRepoId ?? null,
      baseRepoId: details.baseRepoId ?? null,
    }
  } catch (err) {
    log.warn('PR read failed', { attemptId: attempt.id, err: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/** The PR's changed files (with old names), whether the list is whole, and its diff; null when unreadable. */
async function changedFiles(db: SupabaseClient, d: Required<FollowupDeps>, attempt: AttemptRow): Promise<PrFilesForScreen | null> {
  const pr = attempt.pr_url ? parsePullRequestUrl(attempt.pr_url) : null
  if (!pr) return null
  try {
    const token = await d.resolveGithubToken(db, attempt)
    if (!token) return null
    const listed = await d.fetchFiles(token, { owner: pr.owner, repo: pr.repo }, pr.number)
    if (!listed) return null
    return {
      files: listed.files.map((f) => ({ filename: f.filename, previousFilename: f.previousFilename ?? null })),
      complete: listed.complete,
      patches: listed.files.map((f) => f.patch ?? ''),
    }
  } catch (err) {
    log.warn('PR files read failed', { attemptId: attempt.id, err: err instanceof Error ? err.message : String(err) })
    return null
  }
}

async function projectContext(
  db: SupabaseClient,
  projectId: string,
): Promise<{ organizationId: string | null; settings: Record<string, unknown> | null; error: string | null }> {
  const [{ data: project, error: projectErr }, { data: settings, error: settingsErr }] = await Promise.all([
    db.from('projects').select('organization_id').eq('id', projectId).maybeSingle(),
    db
      .from('project_settings')
      .select('autofix_enabled, autofix_max_spend_usd, autofix_max_dispatches_per_day, autofix_approval_cost_threshold_usd, cursor_default_model')
      .eq('project_id', projectId)
      .maybeSingle(),
  ])
  return {
    organizationId: (project as { organization_id?: string | null } | null)?.organization_id ?? null,
    settings: (settings as Record<string, unknown> | null) ?? null,
    error: projectErr?.message ?? settingsErr?.message ?? null,
  }
}

function reportContext(report: Record<string, unknown> | null, reportId: string | null) {
  const s2 = ((report?.stage2_analysis ?? null) as Record<string, unknown> | null) ?? {}
  return {
    id: reportId,
    summary: (report?.summary as string | null) ?? null,
    component: (report?.component as string | null) ?? null,
    rootCause: typeof s2.rootCause === 'string' ? s2.rootCause : null,
    suggestedFix: typeof s2.suggestedFix === 'string' ? s2.suggestedFix : null,
  }
}

function asFindings(raw: unknown): FollowupFinding[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      severity: String(f.severity ?? 'minor'),
      file: String(f.file ?? '(general)'),
      line: typeof f.line === 'number' ? f.line : null,
      issue: String(f.issue ?? ''),
      suggested_fix: String(f.suggested_fix ?? ''),
    }))
    .filter((f) => f.issue.trim() !== '')
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch one queued follow-up
// ─────────────────────────────────────────────────────────────────────────────

export async function dispatchOne(db: SupabaseClient, row: FollowupRow, deps: FollowupDeps = {}): Promise<FollowupOutcome> {
  const d = defaults(deps)
  const now = d.now()
  const nowIso = now.toISOString()
  const runId = d.newRunId()
  const tries = (row.attempts ?? 0) + 1
  if (!(await claim(db, row, runId, now, { attempts: tries }))) return { outcome: 'not_claimed' }

  const finish = async (
    gate: Exclude<DispatchGate, { action: 'dispatch' }>,
    extra: Record<string, unknown> = {},
  ): Promise<FollowupOutcome> => {
    const patch =
      gate.action === 'skip'
        ? { status: 'skipped', skip_reason: gate.reason, error: gate.detail ?? null, finished_at: nowIso, ...extra }
        : { skip_reason: gate.reason, error: gate.detail ?? null, ...extra }
    if (!(await written(ownWrite(db, row.id, runId, now, patch)))) return { outcome: 'superseded' }
    log.info(gate.action === 'skip' ? 'review-followup.skipped' : 'review-followup.waiting', {
      followupId: row.id,
      projectId: row.project_id,
      reason: gate.reason,
      detail: gate.detail ?? null,
    })
    return { outcome: gate.action === 'skip' ? 'skipped' : 'waiting', reason: gate.reason }
  }
  const wait = (reason: FollowupReason, detail?: string, extra: Record<string, unknown> = {}) =>
    finish(expireIfStale(row, { action: 'wait', reason, detail }, now) as Exclude<DispatchGate, { action: 'dispatch' }>, extra)

  const [{ data: reviewData }, attempt, { data: priorData }, ctx] = await Promise.all([
    db.from('fix_reviews').select('id, status, verdict, head_sha, findings').eq('id', row.fix_review_id).maybeSingle(),
    readAttempt(db, row.fix_attempt_id),
    db.from('fix_review_followups').select(PRIOR_COLUMNS).eq('fix_attempt_id', row.fix_attempt_id),
    projectContext(db, row.project_id),
  ])
  const review = reviewData as { id: string; status: string; verdict: string | null; head_sha: string | null; findings: unknown } | null
  // A failed read is not "no organization": wait rather than skip for good.
  if (ctx.error) return wait('budget_unavailable', `app read failed: ${ctx.error}`)
  if (!ctx.organizationId) return finish({ action: 'skip', reason: 'attempt_missing' })

  let settings: FollowupSettings
  try {
    settings = await loadFollowupSettings(db, ctx.organizationId)
  } catch (err) {
    return wait('budget_unavailable', err instanceof Error ? err.message : String(err))
  }
  const pr = attempt ? await livePr(db, d, attempt) : null
  const { data: orgProjects, error: orgProjectsErr } = await db.from('projects').select('id').eq('organization_id', ctx.organizationId)
  if (orgProjectsErr) return wait('budget_unavailable', `organization apps read failed: ${orgProjectsErr.message}`)
  // The daily limit is read here and the dispatch happens a few calls later,
  // so two ticks running at once (cron plus a manual call) can each pass it:
  // the overshoot is bounded by one tick's batch (5). Accepted, not locked.
  let dailyUsed = 0
  try {
    dailyUsed = await orgFollowupsToday(db, ((orgProjects ?? []) as Array<{ id: string }>).map((p) => p.id), now)
  } catch (err) {
    return wait('budget_unavailable', err instanceof Error ? err.message : String(err))
  }
  const s = ctx.settings ?? {}
  let budget: AutofixBudgetCheck | null = null
  try {
    budget = await d.checkBudget(db, row.project_id, {
      autofix_max_spend_usd: (s.autofix_max_spend_usd as number | null) ?? null,
      autofix_max_dispatches_per_day: (s.autofix_max_dispatches_per_day as number | null) ?? null,
      autofix_approval_cost_threshold_usd: (s.autofix_approval_cost_threshold_usd as number | null) ?? null,
    })
  } catch (err) {
    log.warn('auto-fix budget read failed', { followupId: row.id, err: err instanceof Error ? err.message : String(err) })
  }

  // A "merge" review earns a CI repair only while CI on its head fails on
  // the code: read that head's jobs (a failed read waits, never "not failing").
  let ci: CiHeadState | null = null
  if (review?.verdict === 'merge' && review.status !== 'queued' && review.status !== 'running') {
    try {
      ci = ciHeadState(await d.readCiJobs(db, row.project_id, row.head_sha_before))
    } catch (err) {
      return wait('ci_pending', err instanceof Error ? err.message.slice(0, 300) : String(err))
    }
  }

  const gate = followupDispatchGate({
    row,
    review,
    attempt,
    livePr: pr,
    prior: (priorData ?? []) as PriorFollowup[],
    orgEnabled: settings.enabled,
    autofixEnabled: s.autofix_enabled === true,
    dailyUsed,
    dailyLimit: settings.dailyLimit,
    budget,
    ci,
    now,
  })
  if (gate.action !== 'dispatch') return finish(gate)
  const isCiRepair = gate.kind === 'ci_repair'

  // The key that pays, then the model it may run (fail closed).
  const key = await d.resolveKey(db, { projectId: row.project_id, organizationId: ctx.organizationId, keyId: settings.keyId })
  if (!key.ok) return wait(key.reason)
  const spec = settings.model ?? (typeof s.cursor_default_model === 'string' && s.cursor_default_model.trim() ? s.cursor_default_model.trim() : null)
  let model: string | null = null
  if (spec) {
    let models: CursorModelInfo[]
    try {
      models = await cursorModelsCached(key.cacheKey, key.apiKey, now, d.listModels)
    } catch (err) {
      return wait('models_unavailable', err instanceof Error ? err.message.slice(0, 300) : String(err))
    }
    const check = validateCursorModel(spec, models)
    if (!check.ok) return wait(check.reason, check.detail)
    model = check.model
  }

  const prUrl = attempt!.pr_url!
  const repoUrl = repoUrlFromPrUrl(prUrl)
  if (!repoUrl) return finish({ action: 'skip', reason: 'no_pr' })
  let report: Record<string, unknown> | null = null
  if (row.report_id) {
    const { data } = await db.from('reports').select('id, summary, component, stage2_analysis').eq('id', row.report_id).maybeSingle()
    report = (data as Record<string, unknown> | null) ?? null
  }
  let promptText: string
  let sentCount: number
  let droppedCount = 0
  let ciChecks: string[] = []
  if (isCiRepair) {
    // Make CI green without weakening tests: the failing check names and a
    // screened, bounded excerpt of the first few logs (output of
    // agent-written code: untrusted, fenced like the findings).
    const failing = ci?.state === 'code_failure' ? ci.failing.slice(0, CI_REPAIR_MAX_CHECKS) : []
    const token = await d.resolveGithubToken(db, attempt!).catch(() => null)
    const checks: CiRepairCheck[] = []
    for (const [i, job] of failing.entries()) {
      let excerpt: string | null = null
      if (token && i < CI_REPAIR_MAX_EXCERPTS) {
        try {
          const raw = await d.fetchJobLog(token, job.repo, job.jobId)
          if (raw) {
            const ex = extractCiLogExcerpt(raw)
            droppedCount += ex.linesDropped
            excerpt = ex.text || null
          }
        } catch (err) {
          log.warn('CI job log read failed (sent without it)', { followupId: row.id, jobId: job.jobId, err: err instanceof Error ? err.message : String(err) })
        }
      }
      checks.push({ name: job.name, workflow: job.workflow, failedSteps: job.failedSteps, excerpt })
    }
    ciChecks = checks.map((c) => (c.workflow ? `${c.workflow} / ${c.name}` : c.name))
    const prompt = buildCiRepairPrompt({
      report: reportContext(report, row.report_id),
      prUrl,
      branch: pr?.headRef ?? null,
      headSha: row.head_sha_before,
      checks,
      scrub: (t) => sanitizeForLLM(t).text,
    })
    promptText = prompt.text
    sentCount = prompt.checksSent
  } else {
    // Only findings about files this PR changed, with no URL or command in
    // them, reach the agent: the review is model output about agent-written
    // code, the one place an injected instruction could reach the next agent.
    const files = await changedFiles(db, d, attempt!)
    if (!files) return wait('pr_unreadable', 'The changed-file list could not be read.')
    const allFindings = asFindings(review!.findings)
    if (allFindings.length === 0) return finish({ action: 'skip', reason: 'no_findings' })
    const screened = screenFindings(allFindings, files, { ciInfra: readFixCiInfra(attempt!.ci_infra)?.infra === true })
    droppedCount =
      screened.dropped.url + screened.dropped.command + screened.dropped.injection + screened.dropped.ciConfig + screened.dropped.notInPr + screened.dropped.ciInfra
    if (droppedCount > 0) log.info('review-followup.findings_dropped', { followupId: row.id, ...screened.dropped })
    if (screened.kept.length === 0) {
      return finish(
        {
          action: 'skip',
          reason: 'no_usable_findings',
          detail: `${droppedCount} dropped: ${screened.dropped.injection} reading as instructions, ${screened.dropped.ciConfig} about CI or deploy config, ${screened.dropped.command} with a command or a leak, ${screened.dropped.url} with a foreign URL, ${screened.dropped.notInPr} outside the PR, ${screened.dropped.ciInfra} only saying CI stopped on the test machine.`,
        },
        { findings_dropped: droppedCount },
      )
    }
    const prompt = buildFollowupPrompt({
      report: reportContext(report, row.report_id),
      prUrl,
      branch: pr?.headRef ?? null,
      headSha: row.head_sha_before,
      findings: screened.kept,
      scrub: (t) => sanitizeForLLM(t).text,
    })
    promptText = prompt.text
    sentCount = prompt.findingsSent
  }
  const agentId = await deterministicCursorAgentId(`review-followup:${row.id}`)
  const input = followupAgentInput({ prompt: promptText, repoUrl, prUrl, agentId, model, reportId: row.report_id, kind: isCiRepair ? 'ci_repair' : 'findings' })

  let created: { agentId: string; runId: string | null; url: string | null }
  try {
    const res = await d.createAgent(key.apiKey, input)
    created = { agentId: res.agent.id, runId: res.run.id, url: res.agent.url ?? null }
  } catch (err) {
    if (err instanceof CursorApiError && err.status === 409 && err.code === 'agent_id_conflict') {
      // A lost response or a retried tick: the agent exists, adopt it.
      try {
        const existing = await d.getAgent(key.apiKey, agentId)
        created = { agentId: existing.id, runId: existing.latestRunId ?? null, url: existing.url ?? null }
      } catch (readErr) {
        return wait('cursor_error', readErr instanceof Error ? readErr.message.slice(0, 300) : String(readErr))
      }
    } else if (err instanceof CursorApiError && err.status === 409) {
      // agent_busy (one active run per agent): try again next tick.
      return wait('agent_busy', err.message.slice(0, 300))
    } else if (err instanceof CursorApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
      // Cursor refused the request itself (bad model, no repo access, …): the
      // same request would be refused again. Shown in the console as is.
      return finish({ action: 'skip', reason: 'cursor_rejected', detail: err.message.slice(0, 300) }, { findings_dropped: droppedCount })
    } else {
      // 5xx, 429 or the network: back off 2^failures × 10 min, at most 6 h.
      // Counted apart from claims, so waits for other reasons (caps, limits)
      // do not lengthen it.
      const failures = (row.cursor_failures ?? 0) + 1
      return wait('cursor_unavailable', err instanceof Error ? err.message.slice(0, 300) : String(err), {
        cursor_failures: failures,
        queued_at: new Date(now.getTime() + cursorBackoffMs(failures)).toISOString(),
      })
    }
  }

  const saved = await written(
    ownWrite(db, row.id, runId, now, {
      status: 'dispatched',
      cursor_agent_id: created.agentId,
      cursor_run_id: created.runId,
      cursor_agent_url: created.url,
      key_id: key.keyId,
      key_kind: key.source,
      model,
      findings_count: sentCount,
      findings_dropped: droppedCount,
      prompt_chars: promptText.length,
      dispatched_at: nowIso,
      skip_reason: null,
      error: null,
    }),
  )
  // The deterministic agent id makes a retry adopt this agent, so a lost write is recoverable.
  if (!saved) return { outcome: 'superseded' }
  await followupEvent(db, row, {
    status: 'pending',
    label: isCiRepair ? 'CI repair dispatched' : 'Follow-up dispatched',
    detail: isCiRepair
      ? `${sentCount} failing check(s) sent to Cursor to make CI green without weakening tests${model ? ` (${model})` : ''}: ${ciChecks.join(', ').slice(0, 300)}.`
      : `${sentCount} Opus finding(s) sent to Cursor${model ? ` (${model})` : ''}${droppedCount > 0 ? `; ${droppedCount} left out by the safety screen` : ''}.`,
    dedupe: `followup-dispatched:${row.id}`,
    payload: { agentId: created.agentId, runId: created.runId, model, keyId: key.keyId, headSha: row.head_sha_before, kind: isCiRepair ? 'ci_repair' : 'findings', ...(isCiRepair ? { checks: ciChecks } : {}) },
    at: nowIso,
  })
  log.info('review-followup.dispatched', {
    followupId: row.id,
    projectId: row.project_id,
    fixAttemptId: row.fix_attempt_id,
    agentId: created.agentId,
    keyId: key.keyId,
    model,
    kind: isCiRepair ? 'ci_repair' : 'findings',
    findings: sentCount,
    findingsDropped: droppedCount,
    promptChars: promptText.length,
  })
  return { outcome: 'dispatched', agentId: created.agentId }
}

// ─────────────────────────────────────────────────────────────────────────────
// Poll one dispatched / running follow-up
// ─────────────────────────────────────────────────────────────────────────────

export async function pollOne(db: SupabaseClient, row: FollowupRow, deps: FollowupDeps = {}): Promise<FollowupOutcome> {
  const d = defaults(deps)
  const now = d.now()
  const nowIso = now.toISOString()
  const runId = d.newRunId()
  if (!(await claim(db, row, runId, now))) return { outcome: 'not_claimed' }
  const release = () => ownWrite(db, row.id, runId, now, {})
  const age = row.dispatched_at != null ? now.getTime() - Date.parse(row.dispatched_at) : 0
  const timedOut = age >= FOLLOWUP_RUN_TIMEOUT_MS
  const giveUp = age >= FOLLOWUP_RUN_TIMEOUT_MS + FOLLOWUP_CANCEL_GIVE_UP_MS

  const attempt = await readAttempt(db, row.fix_attempt_id)
  const ctx = await projectContext(db, row.project_id)
  let run: CursorRun | null = null
  let readError: string | null = null
  let apiKey: string | null = null
  let cursorRunId = row.cursor_run_id
  if (ctx.organizationId && row.cursor_agent_id) {
    const key = await d.keyForRun(db, row, ctx.organizationId)
    if (!key.ok && key.reason === 'key_removed') {
      // The key that pays for this run was deleted. Do not read or cancel it
      // with another account's key: stop watching and say why.
      const saved = await written(
        ownWrite(db, row.id, runId, now, {
          status: 'failed',
          skip_reason: 'key_removed',
          error: FOLLOWUP_REASONS.key_removed,
          finished_at: nowIso,
        }),
      )
      if (!saved) return { outcome: 'superseded' }
      await followupEvent(db, row, {
        status: 'fail',
        label: 'Follow-up stopped: key deleted',
        detail: FOLLOWUP_REASONS.key_removed,
        dedupe: `followup-key-removed:${row.id}`,
        payload: { agentId: row.cursor_agent_id },
        at: nowIso,
      })
      log.warn('review-followup.key_removed', { followupId: row.id, projectId: row.project_id, agentId: row.cursor_agent_id })
      return { outcome: 'key_removed' }
    }
    if (!key.ok && key.reason === 'key_not_allowed') {
      // The run's key no longer serves this app (a universal key whose owner
      // left the organization, ADR 0031). Stop the agent with that same key
      // if Cursor still accepts it (same account, nothing new spent), then
      // stop watching; never poll on with it or switch to another key.
      let cancelNote = 'no run to cancel'
      const cancelKey = await d.keyForCancel(db, row, ctx.organizationId)
      if (cancelKey.ok && row.cursor_agent_id && cursorRunId) {
        try {
          await d.cancelRun(cancelKey.apiKey, row.cursor_agent_id, cursorRunId)
          cancelNote = 'the run was cancelled'
        } catch (err) {
          cancelNote = `cancel failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`
        }
      } else if (!cancelKey.ok) cancelNote = 'cancel not possible: the key could not be read'
      const saved = await written(
        ownWrite(db, row.id, runId, now, {
          status: 'failed',
          skip_reason: 'key_not_allowed',
          error: `${FOLLOWUP_REASONS.key_not_allowed} Stopped watching; ${cancelNote}.`,
          finished_at: nowIso,
        }),
      )
      if (!saved) return { outcome: 'superseded' }
      await followupEvent(db, row, {
        status: 'fail',
        label: 'Follow-up stopped: key no longer serves this app',
        detail: `${FOLLOWUP_REASONS.key_not_allowed} ${cancelNote}.`,
        dedupe: `followup-key-not-allowed:${row.id}`,
        payload: { agentId: row.cursor_agent_id, cancelNote },
        at: nowIso,
      })
      log.warn('review-followup.key_not_allowed', { followupId: row.id, projectId: row.project_id, cancelNote })
      return { outcome: 'key_removed' }
    }
    if (key.ok) {
      apiKey = key.apiKey
      try {
        if (!cursorRunId) cursorRunId = (await d.getAgent(key.apiKey, row.cursor_agent_id)).latestRunId ?? null
        if (cursorRunId) run = await d.getRun(key.apiKey, row.cursor_agent_id, cursorRunId)
      } catch (err) {
        readError = err instanceof Error ? err.message.slice(0, 300) : String(err)
      }
    } else readError = FOLLOWUP_REASONS[key.reason]
  }

  const status = run?.status ? String(run.status).toUpperCase() : null
  const finishedRun = status === 'FINISHED' || status === 'ERROR' || status === 'CANCELLED' || status === 'EXPIRED'
  if (!finishedRun && !timedOut) {
    if (status === 'RUNNING' && row.status === 'dispatched') {
      await ownWrite(db, row.id, runId, now, { status: 'running', cursor_run_id: run!.id })
    } else await release()
    if (readError) log.warn('follow-up run not read (retried next tick)', { followupId: row.id, err: readError })
    return { outcome: 'running' }
  }

  // Past the timeout and still running: stop the agent before calling it
  // done, so it cannot push after Mushi stopped watching. Only a cancel Cursor
  // accepted (or a terminal status) ends the row; otherwise retry next tick,
  // and give up a day later with the reason stored.
  let cancelled = false
  let cancelError: string | null = null
  if (!finishedRun) {
    if (apiKey && row.cursor_agent_id && cursorRunId) {
      try {
        await d.cancelRun(apiKey, row.cursor_agent_id, cursorRunId)
        cancelled = true
      } catch (err) {
        cancelError = err instanceof Error ? err.message.slice(0, 300) : String(err)
      }
    } else cancelError = readError ?? 'The run could not be read to cancel it.'
    if (!cancelled && !giveUp) {
      await ownWrite(db, row.id, runId, now, { error: `Timed out; cancel not accepted yet: ${cancelError}` })
      log.warn('follow-up cancel failed (retried next tick)', { followupId: row.id, err: cancelError })
      return { outcome: 'running' }
    }
  }

  const pr = attempt ? await livePr(db, d, attempt) : null
  if (finishedRun && !pr && !timedOut) {
    // The head decides pushed vs no change: read it next tick rather than guess.
    await release()
    return { outcome: 'running' }
  }
  const headAfter = pr?.headSha ?? null
  const headKnown = !!headAfter
  const pushed = headKnown && headAfter !== row.head_sha_before
  const finalStatus: 'completed' | 'failed' = finishedRun && status === 'FINISHED' ? 'completed' : 'failed'
  const hours = FOLLOWUP_RUN_TIMEOUT_MS / 3_600_000
  const error = finishedRun
    ? finalStatus === 'failed' ? `Cursor run ended ${status}.` : null
    : cancelled
      ? `Cancelled: no finished run after ${hours} hours.`
      : `No finished run after ${hours} hours and Cursor did not accept a cancel for a day: ${cancelError}`
  const agentResult = typeof run?.result === 'string' ? run.result.slice(0, AGENT_RESULT_MAX) : null
  const saved = await written(
    ownWrite(db, row.id, runId, now, {
      status: finalStatus,
      head_sha_after: headAfter,
      agent_result: agentResult,
      error,
      finished_at: nowIso,
    }),
  )
  if (!saved) return { outcome: 'superseded' }

  if (pushed) {
    await followupEvent(db, row, {
      status: 'ok',
      label: 'Follow-up pushed',
      detail: `New commit ${String(headAfter).slice(0, 7)} on the pull request; Opus reviews it again.`,
      dedupe: `followup-pushed:${row.id}`,
      payload: { headBefore: row.head_sha_before, headAfter, runStatus: status, cancelled },
      at: nowIso,
    })
    // The pull_request.synchronize webhook re-queues the review too, but it may
    // be missing (no GitHub App webhook on the repo): queue it here as well.
    const res = await d.enqueueReview(
      db,
      { fixAttemptId: row.fix_attempt_id, projectId: row.project_id, reportId: row.report_id, prUrl: attempt?.pr_url ?? row.pr_url },
      { force: true, now },
    )
    if (!res.queued) log.warn('re-review not queued after follow-up push', { followupId: row.id, err: res.error ?? null })
  } else if (!headKnown) {
    // GitHub could not be read: do not claim the agent changed nothing.
    await followupEvent(db, row, {
      status: 'fail',
      label: 'Follow-up ended, push unknown',
      detail: `${error ?? `Cursor run ended ${status}.`} Mushi could not read the pull request, so whether the agent pushed is unknown; a push is reviewed when GitHub reports it.`,
      dedupe: `followup-unknown:${row.id}`,
      payload: { headBefore: row.head_sha_before, runStatus: status, timedOut: !finishedRun, cancelled },
      at: nowIso,
    })
  } else {
    const why = agentResult ? sanitizeForLLM(agentResult).text.slice(0, 300) : null
    await followupEvent(db, row, {
      status: finalStatus === 'failed' ? 'fail' : 'pending',
      label: 'Follow-up made no change',
      detail: why ? `The agent pushed nothing. Its last message: ${why}` : `The agent pushed nothing (run ${status ?? (cancelled ? 'cancelled after the timeout' : 'not finished')}).`,
      dedupe: `followup-nochange:${row.id}`,
      payload: { headBefore: row.head_sha_before, runStatus: status, timedOut: !finishedRun, cancelled },
      at: nowIso,
    })
  }
  const outcome = pushed ? 'pushed' : headKnown ? 'no_change' : 'head_unknown'
  log.info(`review-followup.${outcome}`, {
    followupId: row.id,
    projectId: row.project_id,
    fixAttemptId: row.fix_attempt_id,
    runStatus: status,
    timedOut: !finishedRun,
    cancelled,
    headBefore: row.head_sha_before,
    headAfter,
  })
  return { outcome, status: finalStatus }
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery and settling
// ─────────────────────────────────────────────────────────────────────────────

type DiscoveredReview = {
  id: string
  fix_attempt_id: string
  project_id: string
  report_id: string | null
  status: string
  verdict: string | null
  head_sha: string | null
}

/**
 * Queue a follow-up for each fix_first review that has none for its head,
 * and a CI repair for each merge review whose head fails CI on the code
 * (ci_jobs), in organizations with follow-ups on only. Each organization's window
 * starts 3 days before it turned them on (`review_followup_enabled_at`), so
 * turning them on deliberately picks up the last 3 days of fix_first PRs.
 */
export async function discover(db: SupabaseClient, now: Date): Promise<number> {
  const { data: orgs, error: orgErr } = await db
    .from('organizations')
    .select('id, review_followup_enabled_at')
    .eq('review_followup_enabled', true)
  if (orgErr) throw new Error(`organizations with follow-ups read failed: ${orgErr.message}`)
  const reviews: DiscoveredReview[] = []
  for (const org of (orgs ?? []) as Array<{ id: string; review_followup_enabled_at: string | null }>) {
    const enabledAt = org.review_followup_enabled_at ? Date.parse(org.review_followup_enabled_at) : NaN
    const since = new Date((Number.isFinite(enabledAt) ? enabledAt : now.getTime()) - FOLLOWUP_DISCOVERY_WINDOW_MS).toISOString()
    const { data: projects, error: pErr } = await db.from('projects').select('id').eq('organization_id', org.id)
    if (pErr) throw new Error(`organization apps read failed: ${pErr.message}`)
    const ids = ((projects ?? []) as Array<{ id: string }>).map((p) => p.id)
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await db
        .from('fix_reviews')
        .select('id, fix_attempt_id, project_id, report_id, status, verdict, head_sha')
        .in('project_id', ids.slice(i, i + 100))
        .eq('status', 'completed')
        .in('verdict', ['fix_first', 'merge'])
        .gte('reviewed_at', since)
        .order('reviewed_at', { ascending: false })
        .limit(DISCOVERY_SCAN)
      if (error) throw new Error(`fix_first / merge reviews read failed: ${error.message}`)
      reviews.push(...((data ?? []) as DiscoveredReview[]))
    }
  }
  if (reviews.length === 0) return 0
  const attemptIds = [...new Set(reviews.map((r) => r.fix_attempt_id))]
  const attempts = new Map<string, AttemptRow>()
  const prior = new Map<string, PriorFollowup[]>()
  for (let i = 0; i < attemptIds.length; i += 100) {
    const part = attemptIds.slice(i, i + 100)
    const [aRes, fRes] = await Promise.all([
      db.from('fix_attempts').select(ATTEMPT_COLUMNS).in('id', part),
      db.from('fix_review_followups').select(`fix_attempt_id, ${PRIOR_COLUMNS}`).in('fix_attempt_id', part),
    ])
    if (aRes.error) throw new Error(`fix attempts read failed: ${aRes.error.message}`)
    if (fRes.error) throw new Error(`follow-ups read failed: ${fRes.error.message}`)
    for (const a of (aRes.data ?? []) as AttemptRow[]) attempts.set(a.id, a)
    for (const f of (fRes.data ?? []) as Array<PriorFollowup & { fix_attempt_id: string }>) {
      prior.set(f.fix_attempt_id, [...(prior.get(f.fix_attempt_id) ?? []), f])
    }
  }
  // CI on the heads of merge reviews that could still earn a CI repair (open
  // cloud-agent PRs, under the per-PR limit, no follow-up for that head yet).
  const mergeReviews = reviews.filter((r) => {
    if (r.verdict !== 'merge' || !r.head_sha) return false
    const decision = followupTrigger({
      review: r,
      attempt: attempts.get(r.fix_attempt_id) ?? null,
      prior: prior.get(r.fix_attempt_id) ?? [],
      ci: { state: 'code_failure', failing: [] },
    })
    return decision.queue
  })
  let ciByHead = new Map<string, CiJobForRepair[]>()
  if (mergeReviews.length > 0) {
    try {
      ciByHead = await ciJobsForHeads(db, [...new Set(mergeReviews.map((r) => r.project_id))], mergeReviews.map((r) => r.head_sha as string))
    } catch (err) {
      // Next tick reads again; fix_first follow-ups are not held up by it.
      log.warn('CI jobs read for CI repairs failed (next tick)', { err: err instanceof Error ? err.message : String(err) })
    }
  }
  const mergeIds = new Set(mergeReviews.map((r) => r.id))
  let queued = 0
  for (const review of reviews) {
    if (review.verdict === 'merge' && !mergeIds.has(review.id)) continue
    const ci = review.verdict === 'merge'
      ? ciHeadState((ciByHead.get(review.head_sha ?? '') ?? []).filter((j) => !j.project_id || j.project_id === review.project_id))
      : null
    if (review.verdict === 'merge' && ci?.state !== 'code_failure') continue
    const res = await enqueueReviewFollowup(
      db,
      { review, attempt: attempts.get(review.fix_attempt_id) ?? null, prior: prior.get(review.fix_attempt_id) ?? [], ci },
      now,
    )
    if (res.queued) queued++
  }
  return queued
}

/** Record the Opus verdict about each pushed follow-up's new head once that review completes. */
export async function settleVerdicts(db: SupabaseClient, now: Date): Promise<number> {
  const since = new Date(now.getTime() - FOLLOWUP_VERDICT_WINDOW_MS).toISOString()
  const { data, error } = await db
    .from('fix_review_followups')
    .select('id, fix_attempt_id, head_sha_before, head_sha_after')
    .in('status', ['completed', 'failed'])
    .not('head_sha_after', 'is', null)
    .is('verdict_after', null)
    .gte('finished_at', since)
    .limit(100)
  if (error) throw new Error(`pushed follow-ups read failed: ${error.message}`)
  const rows = ((data ?? []) as Array<{ id: string; fix_attempt_id: string; head_sha_before: string; head_sha_after: string | null }>).filter(
    (r) => r.head_sha_after && r.head_sha_after !== r.head_sha_before,
  )
  if (rows.length === 0) return 0
  const { data: reviews, error: rErr } = await db
    .from('fix_reviews')
    .select('fix_attempt_id, status, verdict, head_sha')
    .in('fix_attempt_id', [...new Set(rows.map((r) => r.fix_attempt_id))])
  if (rErr) throw new Error(`reviews read failed: ${rErr.message}`)
  const byAttempt = new Map(
    ((reviews ?? []) as Array<{ fix_attempt_id: string; status: string; verdict: string | null; head_sha: string | null }>).map((r) => [r.fix_attempt_id, r]),
  )
  let settled = 0
  for (const row of rows) {
    const review = byAttempt.get(row.fix_attempt_id)
    if (!review || review.status !== 'completed' || !review.verdict || review.head_sha !== row.head_sha_after) continue
    const { error: upErr } = await db
      .from('fix_review_followups')
      .update({ verdict_after: review.verdict, updated_at: now.toISOString() })
      .eq('id', row.id)
      .is('verdict_after', null)
    if (!upErr) {
      settled++
      log.info('review-followup.verdict_after', { followupId: row.id, fixAttemptId: row.fix_attempt_id, verdict: review.verdict })
    }
  }
  return settled
}

/** Oldest first, at most FOLLOWUP_PER_PROJECT_PER_TICK per app. */
export function pickFollowupBatch<T extends { project_id: string }>(rows: T[], batch = FOLLOWUP_BATCH, perProject = FOLLOWUP_PER_PROJECT_PER_TICK): T[] {
  const taken = new Map<string, number>()
  const out: T[] = []
  for (const row of rows) {
    if (out.length >= batch) break
    const n = taken.get(row.project_id) ?? 0
    if (n >= perProject) continue
    taken.set(row.project_id, n + 1)
    out.push(row)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// A tick
// ─────────────────────────────────────────────────────────────────────────────

export async function runReviewFollowups(db: SupabaseClient, deps: FollowupDeps = {}): Promise<FollowupRunSummary> {
  const now = (deps.now ?? (() => new Date()))()
  const summary: FollowupRunSummary = {
    settled: 0,
    discovered: 0,
    dispatched: 0,
    waiting: 0,
    skipped: 0,
    polled: 0,
    pushed: 0,
    noChange: 0,
    timedOut: 0,
    results: [],
  }
  const tally = (row: FollowupRow, o: FollowupOutcome) => {
    summary.results.push({ followupId: row.id, ...o })
    if (o.outcome === 'dispatched') summary.dispatched++
    else if (o.outcome === 'waiting') summary.waiting++
    else if (o.outcome === 'skipped') summary.skipped++
    else if (o.outcome === 'pushed') summary.pushed++
    else if (o.outcome === 'no_change') summary.noChange++
  }

  try {
    summary.settled = await settleVerdicts(db, now)
  } catch (err) {
    log.warn('settling verdicts failed (next tick)', { err: err instanceof Error ? err.message : String(err) })
  }
  summary.discovered = await discover(db, now)

  const nowIso = now.toISOString()
  const { data: queued, error: qErr } = await db
    .from('fix_review_followups')
    .select(ROW_COLUMNS)
    .eq('status', 'queued')
    .lte('queued_at', nowIso)
    .order('queued_at', { ascending: true })
    .limit(QUEUE_SCAN)
  if (qErr) throw new Error(`follow-up queue read failed: ${qErr.message}`)
  // One at a time: each dispatch reads today's count the next one must see.
  const startedNow = new Set<string>()
  for (const row of pickFollowupBatch((queued ?? []) as FollowupRow[])) {
    try {
      const o = await dispatchOne(db, row, deps)
      if (o.outcome === 'dispatched') startedNow.add(row.id)
      tally(row, o)
    } catch (err) {
      // The claim expires after 15 minutes and the row is tried again.
      log.warn('follow-up dispatch failed unexpectedly', { followupId: row.id, err: err instanceof Error ? err.message : String(err) })
    }
  }

  const { data: active, error: aErr } = await db
    .from('fix_review_followups')
    .select(ROW_COLUMNS)
    .in('status', ['dispatched', 'running'])
    // Least recently touched first: every poll writes updated_at, so a row
    // whose cancel keeps failing goes to the back instead of holding a slot.
    .order('updated_at', { ascending: true })
    .limit(POLL_BATCH)
  if (aErr) throw new Error(`active follow-ups read failed: ${aErr.message}`)
  // An agent started this tick is first polled next tick.
  for (const row of ((active ?? []) as FollowupRow[]).filter((r) => !startedNow.has(r.id))) {
    try {
      const o = await pollOne(db, row, deps)
      summary.polled++
      tally(row, o)
      if ((o.outcome === 'pushed' || o.outcome === 'no_change' || o.outcome === 'head_unknown') && row.dispatched_at &&
        now.getTime() - Date.parse(row.dispatched_at) >= FOLLOWUP_RUN_TIMEOUT_MS) summary.timedOut++
    } catch (err) {
      log.warn('follow-up poll failed unexpectedly', { followupId: row.id, err: err instanceof Error ? err.message : String(err) })
    }
  }

  log.info('review-followup.done', { ...summary, results: summary.results.length })
  return summary
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }), { status: 405 })
  }
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized
  const raw = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as { trigger?: unknown }) : {}
  const db = getServiceClient()
  const cronRun = await startCronRun(db, 'review-followup', raw?.trigger === 'cron' ? 'cron' : 'http')
  try {
    const summary = await runReviewFollowups(db)
    await cronRun.finish({ rowsAffected: summary.dispatched, metadata: { ...summary, results: summary.results.slice(0, 20) } })
    return new Response(JSON.stringify({ ok: true, data: summary }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    await cronRun.fail(err)
    throw err
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('review-followup', handler))
}
