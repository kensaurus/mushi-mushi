// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
/**
 * agent-pr-review — Supabase Edge Function (verify_jwt = false, internal)
 *
 * The independent review of every cloud coding agent's pull request (ADR
 * 0030). When a cloud agent's PR is accepted as a fix (`applyCloudAgentOutcome`,
 * the one path cursor-webhook, agent-status-poll and the GitHub indexer share)
 * a `fix_reviews` row is queued; a push to a reviewed PR re-queues it. Each
 * tick this function:
 *
 *   1. puts reviews stuck in `running` for 15 min back in the queue, or marks
 *      them failed (with a timeline event) after 3 tries;
 *   2. on `{ backfill: true, limit }`, queues a review for every open
 *      cloud-agent PR that has none (newest first, at most `limit`);
 *   3. on `{ fixAttemptId, force }`, queues that attempt (again, with force)
 *      and reviews it now;
 *   4. claims up to 8 due reviews, at most one per project per tick, and runs
 *      them side by side. A claim stamps a fresh `run_id`; every later write
 *      of that run is guarded on it, so a run that a re-queue or a newer run
 *      superseded can never overwrite the row.
 *        - skipped, with the reason stored, when the project turned review
 *          off, has no Anthropic key of its own (BYOK; the platform key is
 *          never spent on this), is over its monthly AI budget, or Mushi
 *          cannot read the PR;
 *        - otherwise the report (summary, description, repro, diagnosis),
 *          the PR title and description, CI on the head commit and the diff
 *          (budgeted by `buildReviewDiff`) go to Claude Opus 5.5 with
 *          structured output; the verdict is made consistent with its own
 *          findings (`normalizeReview`), stored with the reviewed head SHA,
 *          model, tokens and cost, added to the fix timeline ("Opus review:
 *          hold"), and posted as one PR comment (no report text; a link to
 *          the console) that later reviews edit in place. A "fix_first"
 *          verdict also queues one review follow-up (ADR 0032,
 *          `review-followup`).
 *   A skipped or failed run keeps the last completed verdict, so a hold stays
 *   a hold. A model error retries after 10 min × tries.
 *
 * Readying (host repos skip CI on drafts): a cloud agent's PR is marked
 * ready on "merge" or "fix_first". fix-worker opens every PR as a draft and
 * queues this review (ADR 0047); its PR is marked ready only on "merge", only
 * when the model's own check passed, and only while the reviewed commit is
 * still the PR's head. When no review can run for it (review off, no
 * Anthropic key, AI budget used up) and it has no verdict yet, the
 * self-check alone decides, as before ADR 0047.
 *
 * Nothing here merges. A "hold" verdict makes every Mushi merge path refuse
 * until a person overrides it from the console with a reason.
 *
 * Wall clock: the repo assumes 150 s per edge invocation (inventory-propose
 * keeps a 110 s run budget). Reviews run in parallel, each model call aborts
 * at 100 s, and usage is recorded as soon as the call returns.
 *
 * Auth: `requireServiceRoleAuth`. Invoked by pg_cron `mushi-agent-pr-review`
 * (migration 20261020172855, `3-53/10 * * * *`) and by
 * POST /v1/admin/fixes/:id/review (re-run).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveLlmKey, type ResolvedKey } from '../_shared/byok.ts'
import { claudeGenerateObject } from '../_shared/claude-messages.ts'
import { isClaudeRefusal, resolveClaudeModel } from '../_shared/claude-request.ts'
import { estimateCallCostUsd } from '../_shared/pricing.ts'
import { recordLlmUsage, extractLlmUsage, servedModel } from '../_shared/llm-usage.ts'
import { sanitizeForLLM } from '../_shared/sanitize.ts'
import { mapWithConcurrency } from '../_shared/concurrency.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import { fetchWithTimeout } from '../_shared/http.ts'
import {
  fetchPullRequestDetails,
  fetchPullRequestFiles,
  installationIdForAttempt,
  markPullRequestReady,
  resolveProjectGithubToken,
  type GithubRepoRef,
  type PullRequestDetails,
  type PullRequestFile,
} from '../_shared/github.ts'
import { canonicalPrUrl, parsePullRequestUrl } from '../_shared/pr-substance.ts'
import { DISPATCHABLE_CLOUD_AGENTS, FIX_WORKER_AGENTS } from '../_shared/agent-adapters.ts'
import { AGENT_PR_REVIEW_EFFORT, AGENT_PR_REVIEW_MODEL } from '../_shared/models.ts'
import { enqueueFixReview } from '../_shared/fix-review-db.ts'
import { enqueueReviewFollowup } from '../_shared/review-followup-db.ts'
import {
  AGENT_PR_REVIEW_SYSTEM_PROMPT,
  agentPrReviewSchema,
  buildReviewDiff,
  buildReviewPrompt,
  ciPromptText,
  describeCi,
  formatReviewComment,
  normalizeReview,
  REVIEW_RUN_STALE_MS,
  REVIEW_SKIP_REASONS,
  VERDICT_LABEL,
  type AgentPrReviewRaw,
  type NormalizedReview,
  type ReviewSkipReason,
  type ReviewVerdict,
} from '../_shared/fix-review.ts'

const log = rootLog.child('agent-pr-review')

/**
 * Reviews run per tick, side by side (each call is capped at 100 s, so the
 * tick stays inside the function's wall time). 3 a tick fell behind on
 * 2026-10-23: 74 queued, the oldest 4 hours old, while the merge queue
 * waited on re-reviews; one per app across 8 apps keeps every app moving.
 */
export const REVIEW_BATCH = 8
/** Fairness: one project's backlog cannot take every slot of a tick. */
export const REVIEW_MAX_PER_PROJECT_PER_TICK = 1
/** Due rows read per tick to fill the batch fairly (one app's backlog can fill 30). */
const QUEUE_SCAN = 120
export const REVIEW_MAX_TRIES = 3
export const REVIEW_STALE_MS = REVIEW_RUN_STALE_MS
/** A model error waits this long × tries before the next try. */
export const REVIEW_RETRY_BACKOFF_MS = 10 * 60_000
/**
 * Under the 150 s edge wall clock the repo assumes (inventory-propose runs a
 * 110 s budget), with room left to record usage and store the verdict.
 */
export const REVIEW_CALL_TIMEOUT_MS = 100_000
/**
 * Thinking counts toward max_tokens. 8k is about what Opus 5.5 writes in the
 * 100 s window; a larger cap would only be cut off by the timeout. Worst case
 * per try: ~35k input × $4 + 8k output × $20 per MTok ≈ $0.30.
 */
export const REVIEW_MAX_TOKENS = 8_000
export const BACKFILL_DEFAULT_LIMIT = 50
export const BACKFILL_MAX_LIMIT = 200
/** Pages of open PRs one backfill reads at most (pageSize = max(limit, default)). */
const BACKFILL_MAX_PAGES = 10

const ATTEMPT_COLUMNS =
  'id, project_id, report_id, agent, status, pr_url, pr_number, pr_state, merged_at, branch, branch_name, repo_id, check_run_status, check_run_conclusion, ci_infra, review_passed'
const REPORT_COLUMNS = 'id, summary, description, category, severity, component, reproduction_steps, stage2_analysis'
const QUEUE_COLUMNS = 'id, fix_attempt_id, project_id, report_id, attempts, comment_id'

interface QueueRow {
  id: string
  fix_attempt_id: string
  project_id: string
  report_id: string | null
  attempts: number | null
  comment_id: number | string | null
}

interface AttemptRow {
  id: string
  project_id: string
  report_id: string | null
  agent: string
  status: string
  pr_url: string | null
  pr_number: number | null
  pr_state: string | null
  merged_at: string | null
  branch: string | null
  branch_name: string | null
  repo_id: string | null
  check_run_status: string | null
  check_run_conclusion: string | null
  /** The CI verdict for the PR head (Plan 022); an infra verdict never holds a merge. */
  ci_infra?: unknown
  /** fix-worker's own check of its fix (false: flagged, the PR stays a draft). */
  review_passed?: boolean | null
}

export interface ModelCallInput {
  apiKey: string
  model: string
  system: string
  prompt: string
  abortSignal?: AbortSignal
}

export interface ModelCallResult {
  object: AgentPrReviewRaw
  usage?: { promptTokens?: number; completionTokens?: number }
  response?: { modelId?: string }
}

export interface ReviewDeps {
  now?: () => Date
  /** The claim token for a run; injectable so tests can assert the guarded writes. */
  newRunId?: () => string
  resolveAnthropicKey?: (db: SupabaseClient, projectId: string) => Promise<ResolvedKey | null>
  resolveGithubToken?: (db: SupabaseClient, attempt: AttemptRow) => Promise<string | null>
  fetchPr?: (token: string, ref: GithubRepoRef, n: number) => Promise<PullRequestDetails | null>
  fetchFiles?: (token: string, ref: GithubRepoRef, n: number) => Promise<{ files: PullRequestFile[]; complete: boolean } | null>
  callModel?: (input: ModelCallInput) => Promise<ModelCallResult>
  /** The platform reviewer model (env `AGENT_PR_REVIEW_MODEL`); tests pin it. */
  platformModel?: string | null
  upsertComment?: (
    token: string,
    ref: GithubRepoRef,
    n: number,
    body: string,
    existingId: number | null,
  ) => Promise<{ id: number; url: string } | null>
  markReady?: (
    token: string,
    ref: GithubRepoRef,
    n: number,
  ) => Promise<{ ok: boolean; alreadyReady: boolean; message?: string }>
  consoleBaseUrl?: () => string
}

export type ReviewOutcome =
  | { outcome: 'completed'; verdict: ReviewVerdict }
  | { outcome: 'skipped'; reason: ReviewSkipReason }
  | { outcome: 'retry' | 'failed'; error: string }
  | { outcome: 'not_claimed' }
  | { outcome: 'superseded' }

export interface ReviewRunSummary {
  requeued: number
  gaveUp: number
  enqueued: number
  claimed: number
  completed: number
  skipped: number
  retried: number
  failed: number
  superseded: number
  verdicts: Record<ReviewVerdict, number>
  results: Array<{ reviewId: string; fixAttemptId: string } & ReviewOutcome>
}

export interface ReviewRunOptions {
  backfill?: boolean
  limit?: number
  fixAttemptId?: string
  force?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Default I/O
// ─────────────────────────────────────────────────────────────────────────────

async function defaultResolveGithubToken(db: SupabaseClient, attempt: AttemptRow): Promise<string | null> {
  const installationId = await installationIdForAttempt(db, attempt)
  return resolveProjectGithubToken(db, attempt.project_id, installationId)
}

/**
 * The reviewer model: the project's `agent_pr_review_model`, else the
 * platform's `AGENT_PR_REVIEW_MODEL` env, else the code default. A better
 * Claude model is a setting away, never a deploy. Retired ids map back to the
 * default (`resolveClaudeModel`), and a non-Claude id does too: the review
 * always runs on the project's Anthropic key.
 *
 * @internal Exported for tests only.
 */
export function pickReviewModel(projectModel: string | null | undefined, platformModel: string | null | undefined): string {
  const chosen = (projectModel ?? '').trim() || (platformModel ?? '').trim()
  const resolved = resolveClaudeModel(chosen, AGENT_PR_REVIEW_MODEL)
  return /^claude-/.test(resolved) ? resolved : AGENT_PR_REVIEW_MODEL
}

/**
 * Whether reviews are on and which model the project chose. A failed read
 * reviews on the default (the switch defaults to true). Before migration
 * 20261022021555 adds `agent_pr_review_model`, naming it fails the read, so it
 * is read again without it: a project that turned reviews off stays off.
 *
 * @internal Exported for tests only.
 */
export async function readReviewSettings(
  db: SupabaseClient,
  projectId: string,
): Promise<{ enabled: boolean; model: string | null }> {
  const read = (columns: string) =>
    db.from('project_settings').select(columns).eq('project_id', projectId).maybeSingle()
  let { data, error } = await read('agent_pr_review_enabled, agent_pr_review_model')
  if (error) ({ data, error } = await read('agent_pr_review_enabled'))
  const row = (data as { agent_pr_review_enabled?: boolean | null; agent_pr_review_model?: string | null } | null) ?? null
  return { enabled: row?.agent_pr_review_enabled !== false, model: row?.agent_pr_review_model ?? null }
}

async function defaultCallModel(input: ModelCallInput): Promise<ModelCallResult> {
  const result = await claudeGenerateObject({
    apiKey: input.apiKey,
    model: input.model,
    schema: agentPrReviewSchema,
    effort: AGENT_PR_REVIEW_EFFORT,
    system: input.system,
    prompt: input.prompt,
    maxTokens: REVIEW_MAX_TOKENS,
    timeoutMs: REVIEW_CALL_TIMEOUT_MS,
    abortSignal: input.abortSignal,
  })
  return result as unknown as ModelCallResult
}

/** Console base for the report link; ADMIN_BASE_URL wins when it is an https URL. */
function defaultConsoleBaseUrl(): string {
  const env = typeof Deno !== 'undefined' ? Deno.env.get('ADMIN_BASE_URL') : undefined
  return env && /^https:\/\//.test(env) ? env.replace(/\/$/, '') : 'https://kensaur.us/mushi-mushi/admin'
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

/** One Mushi review comment per PR: edit the earlier one, else post a new one. */
async function defaultUpsertComment(
  token: string,
  ref: GithubRepoRef,
  n: number,
  body: string,
  existingId: number | null,
): Promise<{ id: number; url: string } | null> {
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`
  if (existingId) {
    const res = await fetchWithTimeout(`${base}/issues/comments/${existingId}`, {
      method: 'PATCH',
      headers: githubHeaders(token),
      body: JSON.stringify({ body }),
    })
    if (res.ok) {
      const json = (await res.json()) as { id?: number; html_url?: string }
      return { id: json.id ?? existingId, url: json.html_url ?? '' }
    }
    if (res.status !== 404) throw new Error(`comment update ${res.status}`)
  }
  const res = await fetchWithTimeout(`${base}/issues/${n}/comments`, {
    method: 'POST',
    headers: githubHeaders(token),
    body: JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error(`comment post ${res.status}`)
  const json = (await res.json()) as { id?: number; html_url?: string }
  return json.id ? { id: json.id, url: json.html_url ?? '' } : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline events
// ─────────────────────────────────────────────────────────────────────────────

async function insertReviewEvent(
  db: SupabaseClient,
  target: { id: string; fix_attempt_id: string; project_id: string },
  ev: { status: 'ok' | 'fail' | 'pending'; label: string; detail: string; dedupe: string; payload: Record<string, unknown> },
): Promise<void> {
  const { error } = await db.from('fix_events').insert({
    fix_attempt_id: target.fix_attempt_id,
    project_id: target.project_id,
    kind: 'reviewed',
    status: ev.status,
    label: ev.label,
    detail: ev.detail.slice(0, 500),
    at: new Date().toISOString(),
    dedupe_key: ev.dedupe,
    payload: ev.payload,
  })
  if (error && error.code !== '23505') log.warn('fix_events review insert failed (non-fatal)', { reviewId: target.id, err: error.message })
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue maintenance
// ─────────────────────────────────────────────────────────────────────────────

async function recoverStale(db: SupabaseClient, now: Date): Promise<{ requeued: number; gaveUp: number }> {
  const staleIso = new Date(now.getTime() - REVIEW_STALE_MS).toISOString()
  const at = now.toISOString()
  const message = `The review did not finish after ${REVIEW_MAX_TRIES} tries.`
  const { data: gaveUp } = await db
    .from('fix_reviews')
    .update({ status: 'failed', run_id: null, error: message, completed_at: at, updated_at: at })
    .eq('status', 'running')
    .lt('started_at', staleIso)
    .gte('attempts', REVIEW_MAX_TRIES)
    .select('id, fix_attempt_id, project_id, attempts')
  for (const row of (gaveUp ?? []) as Array<{ id: string; fix_attempt_id: string; project_id: string; attempts: number | null }>) {
    await insertReviewEvent(db, row, {
      status: 'pending',
      label: 'Opus review failed',
      detail: message,
      dedupe: `review-fail:${row.id}:${row.attempts ?? REVIEW_MAX_TRIES}`,
      payload: { reviewId: row.id, gaveUp: true },
    })
  }
  const { data: requeued } = await db
    .from('fix_reviews')
    .update({ status: 'queued', run_id: null, queued_at: at, updated_at: at })
    .eq('status', 'running')
    .lt('started_at', staleIso)
    .lt('attempts', REVIEW_MAX_TRIES)
    .select('id')
  return { requeued: requeued?.length ?? 0, gaveUp: gaveUp?.length ?? 0 }
}

/** Queue a review for each open cloud-agent or fix-worker PR that has none. */
export async function enqueueBackfill(db: SupabaseClient, limit: number, now: Date): Promise<number> {
  // Page through open cloud-agent PRs newest first, skipping ones that already
  // have a review, until `limit` new reviews are queued. Reading only the
  // newest `limit` rows (2026-10-21) never reached older unreviewed PRs once
  // the newest ones were all reviewed: mushi-mushi #524–#532 stayed unreviewed.
  const pageSize = Math.max(limit, BACKFILL_DEFAULT_LIMIT)
  const seen = new Set<string>()
  let queued = 0
  for (let page = 0; page < BACKFILL_MAX_PAGES && queued < limit; page++) {
    const from = page * pageSize
    const { data: open, error } = await db
      .from('fix_attempts')
      .select('id, project_id, report_id, pr_url')
      .in('agent', [...DISPATCHABLE_CLOUD_AGENTS, ...FIX_WORKER_AGENTS])
      .eq('status', 'completed')
      .not('pr_url', 'is', null)
      .in('pr_state', ['open', 'draft'])
      .is('merged_at', null)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`backfill: open PR read failed: ${error.message}`)
    const fetched = (open ?? []) as Array<{ id: string; project_id: string; report_id: string | null; pr_url: string | null }>
    const rows = fetched.filter((r) => !seen.has(r.id))
    for (const r of rows) seen.add(r.id)
    if (rows.length === 0) break
    const { data: existing, error: existingErr } = await db
      .from('fix_reviews')
      .select('fix_attempt_id')
      .in('fix_attempt_id', rows.map((r) => r.id))
    if (existingErr) throw new Error(`backfill: review read failed: ${existingErr.message}`)
    const have = new Set(((existing ?? []) as Array<{ fix_attempt_id: string }>).map((r) => r.fix_attempt_id))
    for (const r of rows) {
      if (queued >= limit) break
      if (have.has(r.id)) continue
      const res = await enqueueFixReview(
        db,
        { fixAttemptId: r.id, projectId: r.project_id, reportId: r.report_id, prUrl: r.pr_url },
        { now },
      )
      if (res.queued) queued++
    }
    if (fetched.length < pageSize) break
  }
  return queued
}

/** In the order given (re-reviews, then oldest due), at most REVIEW_MAX_PER_PROJECT_PER_TICK per project. */
export function pickFairBatch<T extends { project_id: string }>(rows: T[], batch = REVIEW_BATCH, perProject = REVIEW_MAX_PER_PROJECT_PER_TICK): T[] {
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
// One review
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_STATUS: Record<ReviewVerdict, 'ok' | 'pending' | 'fail'> = { merge: 'ok', fix_first: 'pending', hold: 'fail' }

export const READY_AFTER_REVIEW_LABEL = 'Marked ready after review; CI runs now'
export const READY_WITHOUT_REVIEW_LABEL = 'Marked ready without an Opus review; CI runs now'

/** Skips after which a never-reviewed fix-worker PR falls back to the model's own check (ADR 0047). */
export const NO_REVIEW_FALLBACK_REASONS: ReadonlySet<ReviewSkipReason> = new Set(['review_off', 'no_anthropic_key', 'llm_budget_exceeded'])

/**
 * Whether a verdict readies the PR. Cloud agents: "merge" or "fix_first" (a
 * follow-up agent works on it with CI in view). fix-worker (ADR 0047): only
 * "merge", and never a fix its model flagged.
 */
export function readiesOnVerdict(attempt: { agent: string; review_passed?: boolean | null }, verdict: ReviewVerdict): boolean {
  if (FIX_WORKER_AGENTS.has(attempt.agent)) return verdict === 'merge' && attempt.review_passed !== false
  return verdict === 'merge' || verdict === 'fix_first'
}

/**
 * No review can run for this project. A fix-worker PR that was never
 * reviewed is readied when its model's own check passed, as before ADR 0047,
 * so it is not stranded as a draft; a PR with any verdict on record keeps it.
 */
async function readyWithoutReview(
  db: SupabaseClient,
  row: QueueRow,
  attempt: AttemptRow,
  reason: ReviewSkipReason,
  deps: ReviewDeps,
): Promise<void> {
  if (!FIX_WORKER_AGENTS.has(attempt.agent) || attempt.review_passed !== true) return
  const { data: last } = await db.from('fix_reviews').select('verdict').eq('id', row.id).maybeSingle()
  if ((last as { verdict?: string | null } | null)?.verdict) return
  const pr = attempt.pr_url ? parsePullRequestUrl(attempt.pr_url) : null
  if (!pr) return
  const token = await (deps.resolveGithubToken ?? defaultResolveGithubToken)(db, attempt)
  if (!token) return
  const ref: GithubRepoRef = { owner: pr.owner, repo: pr.repo }
  const details = await (deps.fetchPr ?? fetchPullRequestDetails)(token, ref, pr.number)
  if (!details || details.merged || details.state === 'closed' || details.draft !== true) return
  const ready = await (deps.markReady ?? markPullRequestReady)(token, ref, pr.number)
  if (ready.ok && !ready.alreadyReady) {
    await insertReviewEvent(db, row, {
      status: 'ok',
      label: READY_WITHOUT_REVIEW_LABEL,
      detail: `${REVIEW_SKIP_REASONS[reason]}. The fix passed its own check.`,
      dedupe: `review-ready-noreview:${row.id}:${details.headSha ?? 'none'}`,
      payload: { reviewId: row.id, skipReason: reason, headSha: details.headSha ?? null },
    })
  } else if (!ready.ok) {
    log.warn('PR not marked ready (no review)', { reviewId: row.id, message: ready.message })
  }
}

function reportContext(report: Record<string, unknown> | null) {
  const s2 = ((report?.stage2_analysis ?? null) as Record<string, unknown> | null) ?? {}
  const steps = (s2.reproductionSteps ?? report?.reproduction_steps ?? null) as unknown
  return {
    summary: (report?.summary as string | null) ?? null,
    description: (report?.description as string | null) ?? null,
    category: (report?.category as string | null) ?? null,
    severity: (report?.severity as string | null) ?? null,
    component: (report?.component as string | null) ?? null,
    reproductionSteps: Array.isArray(steps) ? steps.map(String) : null,
    rootCause: typeof s2.rootCause === 'string' ? s2.rootCause : null,
    suggestedFix: typeof s2.suggestedFix === 'string' ? s2.suggestedFix : null,
  }
}

export async function reviewOne(db: SupabaseClient, row: QueueRow, deps: ReviewDeps = {}): Promise<ReviewOutcome> {
  const now = deps.now?.() ?? new Date()
  const nowIso = now.toISOString()
  const tries = (row.attempts ?? 0) + 1
  const runId = deps.newRunId?.() ?? crypto.randomUUID()

  const { data: claimed, error: claimErr } = await db
    .from('fix_reviews')
    .update({ status: 'running', run_id: runId, started_at: nowIso, attempts: tries, updated_at: nowIso })
    .eq('id', row.id)
    .eq('status', 'queued')
    .lte('queued_at', nowIso)
    .select('id')
  if (claimErr || !claimed || claimed.length === 0) return { outcome: 'not_claimed' }

  /** Every write of this run: only while this run still owns the row. */
  const ownWrite = (patch: Record<string, unknown>) =>
    db.from('fix_reviews').update({ ...patch, updated_at: nowIso }).eq('id', row.id).eq('status', 'running').eq('run_id', runId).select('id')

  const finishSkipped = async (attempt: AttemptRow | null, reason: ReviewSkipReason): Promise<ReviewOutcome> => {
    // The last completed verdict (if any) is kept: a skip never clears a hold.
    const { data } = await ownWrite({ status: 'skipped', skip_reason: reason, error: null, completed_at: nowIso })
    if (!data || data.length === 0) return { outcome: 'superseded' }
    if (attempt && reason !== 'review_off') {
      await insertReviewEvent(db, row, {
        status: 'pending',
        label: 'Opus review skipped',
        detail: REVIEW_SKIP_REASONS[reason],
        dedupe: `review-skip:${row.id}:${reason}:${tries}`,
        payload: { reviewId: row.id, skipReason: reason },
      })
    }
    if (attempt && NO_REVIEW_FALLBACK_REASONS.has(reason)) {
      try {
        await readyWithoutReview(db, row, attempt, reason, deps)
      } catch (err) {
        log.warn('PR not marked ready (no review)', { reviewId: row.id, err: err instanceof Error ? err.message : String(err) })
      }
    }
    return { outcome: 'skipped', reason }
  }

  const { data: attemptData } = await db.from('fix_attempts').select(ATTEMPT_COLUMNS).eq('id', row.fix_attempt_id).maybeSingle()
  const attempt = (attemptData as AttemptRow | null) ?? null
  if (!attempt) return finishSkipped(null, 'attempt_missing')
  if (!attempt.pr_url) return finishSkipped(attempt, 'no_pr')
  if (attempt.merged_at || attempt.pr_state === 'merged' || attempt.pr_state === 'closed') {
    return finishSkipped(attempt, 'pr_not_open')
  }

  // Default on: a missing row or a failed read reviews (the column defaults to true).
  const settings = await readReviewSettings(db, attempt.project_id)
  if (!settings.enabled) return finishSkipped(attempt, 'review_off')
  const reviewModel = pickReviewModel(
    settings.model,
    deps.platformModel !== undefined ? deps.platformModel : typeof Deno !== 'undefined' ? Deno.env.get('AGENT_PR_REVIEW_MODEL') : undefined,
  )

  let key: ResolvedKey | null
  try {
    key = await (deps.resolveAnthropicKey ?? ((d, p) => resolveLlmKey(d, p, 'anthropic')))(db, attempt.project_id)
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'LlmBudgetExceededError') {
      return finishSkipped(attempt, 'llm_budget_exceeded')
    }
    throw err
  }
  // The project's own (or its organization's shared) key only: a review the
  // project did not pay for would be an unbilled Opus call on the platform key.
  if (!key || key.source !== 'byok') return finishSkipped(attempt, 'no_anthropic_key')

  const pr = parsePullRequestUrl(attempt.pr_url)
  if (!pr) return finishSkipped(attempt, 'pr_not_found')
  const ref: GithubRepoRef = { owner: pr.owner, repo: pr.repo }
  const token = await (deps.resolveGithubToken ?? defaultResolveGithubToken)(db, attempt)
  if (!token) return finishSkipped(attempt, 'no_github_token')

  const details = await (deps.fetchPr ?? fetchPullRequestDetails)(token, ref, pr.number)
  // A verdict is always about one commit: no head SHA, no review.
  if (!details || !details.headSha) return finishSkipped(attempt, 'pr_not_found')
  if (details.merged || details.state === 'closed') return finishSkipped(attempt, 'pr_not_open')
  const listed = await (deps.fetchFiles ?? fetchPullRequestFiles)(token, ref, pr.number)
  if (!listed) return finishSkipped(attempt, 'pr_not_found')
  if (listed.files.length === 0) return finishSkipped(attempt, 'no_files')

  const diff = buildReviewDiff(listed.files, { complete: listed.complete })
  const ci = describeCi(attempt.check_run_conclusion, attempt.check_run_status, attempt.ci_infra, details.draft === true)
  let report: Record<string, unknown> | null = null
  if (attempt.report_id) {
    const { data } = await db.from('reports').select(REPORT_COLUMNS).eq('id', attempt.report_id).maybeSingle()
    report = (data as Record<string, unknown> | null) ?? null
  }
  const prompt = buildReviewPrompt({
    report: reportContext(report),
    pr: {
      title: details.title ?? null,
      body: details.body ?? null,
      agent: attempt.agent,
      branch: details.headRef ?? attempt.branch_name ?? attempt.branch,
      headSha: details.headSha,
    },
    ci: ciPromptText(ci),
    diff,
    scrub: (t) => sanitizeForLLM(t).text,
  })

  const usageCtx = {
    functionName: 'agent-pr-review',
    stage: 'pr_review',
    projectId: attempt.project_id,
    reportId: attempt.report_id,
    model: reviewModel,
    keySource: key.source,
    startedAt: Date.now(),
  } as const
  let result: ModelCallResult
  try {
    result = await (deps.callModel ?? defaultCallModel)({
      apiKey: key.key,
      model: reviewModel,
      system: AGENT_PR_REVIEW_SYSTEM_PROMPT,
      prompt,
      abortSignal: AbortSignal.timeout(REVIEW_CALL_TIMEOUT_MS + 5_000),
    })
  } catch (err) {
    // A failed call can still have spent tokens (a schema-invalid answer):
    // record it before anything else.
    void recordLlmUsage(db, usageCtx, { error: err })
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    const final = isClaudeRefusal(err) || tries >= REVIEW_MAX_TRIES
    const { data } = await ownWrite({
      status: final ? 'failed' : 'queued',
      run_id: null,
      error: isClaudeRefusal(err) ? 'Claude declined to review this pull request.' : message,
      ...(final
        ? { completed_at: nowIso }
        : { queued_at: new Date(now.getTime() + REVIEW_RETRY_BACKOFF_MS * tries).toISOString() }),
    })
    if (!data || data.length === 0) return { outcome: 'superseded' }
    if (final) {
      await insertReviewEvent(db, row, {
        status: 'pending',
        label: 'Opus review failed',
        detail: message,
        dedupe: `review-fail:${row.id}:${tries}`,
        payload: { reviewId: row.id },
      })
    }
    return final ? { outcome: 'failed', error: message } : { outcome: 'retry', error: message }
  }
  // Record the spend first: everything below may throw.
  void recordLlmUsage(db, usageCtx, { result })

  const review: NormalizedReview = normalizeReview(result.object, {
    ciFailed: ci.failed,
    diffTruncated: diff.truncated,
    sourceOmitted: diff.sourceOmitted.length > 0,
    fileListIncomplete: diff.fileListIncomplete,
  })
  const model = servedModel(result, reviewModel)
  const tokens = extractLlmUsage(result)
  const cost = estimateCallCostUsd(model, tokens.inputTokens ?? 0, tokens.outputTokens ?? 0)

  const { data: saved, error: saveErr } = await ownWrite({
    status: 'completed',
    run_id: null,
    verdict: review.verdict,
    fixes_report: review.fixes_report,
    risk: review.risk,
    findings: review.findings,
    scope_creep: review.scope_creep,
    removes_behavior: review.removes_behavior,
    needs_human_decision: review.needs_human_decision,
    summary: review.summary,
    rules_applied: review.rules_applied,
    skip_reason: null,
    error: null,
    pr_url: canonicalPrUrl(attempt.pr_url) ?? attempt.pr_url,
    repo: `${pr.owner}/${pr.repo}`.toLowerCase(),
    // GitHub's id survives a rename; the merge gate finds this review by it.
    repo_id: details.baseRepoId ?? null,
    pr_number: pr.number,
    head_sha: details.headSha,
    diff_truncated: diff.truncated,
    diff_stats: {
      files: diff.totalFiles,
      shownFiles: diff.shownFiles,
      additions: diff.additions,
      deletions: diff.deletions,
      omittedForBudget: diff.omittedForBudget.slice(0, 50),
      sourceOmitted: diff.sourceOmitted.slice(0, 50),
      fileListIncomplete: diff.fileListIncomplete,
    },
    ci_state: ci.text,
    model,
    input_tokens: tokens.inputTokens ?? null,
    output_tokens: tokens.outputTokens ?? null,
    cost_usd: Math.round(cost * 10_000) / 10_000,
    reviewed_at: nowIso,
    completed_at: nowIso,
  })
  if (saveErr) throw new Error(`review save failed: ${saveErr.message}`)
  // A re-queue (new push, re-run) or a newer run took the row: this verdict is
  // about a commit nobody is merging any more. Drop it; the next run decides.
  if (!saved || saved.length === 0) return { outcome: 'superseded' }

  await insertReviewEvent(db, row, {
    status: EVENT_STATUS[review.verdict],
    label: `Opus review: ${VERDICT_LABEL[review.verdict]}`,
    detail: review.summary,
    dedupe: `review:${row.id}:${details.headSha ?? nowIso}:${tries}`,
    payload: {
      reviewId: row.id,
      verdict: review.verdict,
      risk: review.risk,
      fixesReport: review.fixes_report,
      findings: review.findings.length,
      blockers: review.findings.filter((f) => f.severity === 'blocker').length,
      model,
      headSha: details.headSha,
    },
  })

  // A "fix first" verdict on this head earns one follow-up (ADR 0032): a new
  // Cursor agent on the PR with these findings. The review-followup worker
  // also discovers it, so a failed enqueue here only delays it a tick.
  if (review.verdict === 'fix_first') {
    const queued = await enqueueReviewFollowup(
      db,
      {
        review: { id: row.id, fix_attempt_id: row.fix_attempt_id, project_id: attempt.project_id, report_id: attempt.report_id, status: 'completed', verdict: 'fix_first', head_sha: details.headSha },
        attempt,
        requireEnabled: true,
      },
      now,
    )
    if (queued.error) log.warn('review follow-up not queued (worker discovery retries)', { reviewId: row.id, err: queued.error })
  }

  try {
    const reportUrl = attempt.report_id ? `${(deps.consoleBaseUrl ?? defaultConsoleBaseUrl)()}/reports/${attempt.report_id}` : null
    const body = formatReviewComment(review, { model, headSha: details.headSha, diff, reportUrl })
    const existing = row.comment_id == null ? null : Number(row.comment_id) || null
    const posted = await (deps.upsertComment ?? defaultUpsertComment)(token, ref, pr.number, body, existing)
    if (posted) {
      await db.from('fix_reviews').update({ comment_id: posted.id, comment_url: posted.url || null }).eq('id', row.id)
    }
  } catch (err) {
    // The verdict is stored and gates merges either way; the comment is a courtesy.
    log.warn('review comment not posted', { reviewId: row.id, err: err instanceof Error ? err.message : String(err) })
  }

  // Host repos skip CI on draft PRs and run it on ready_for_review (glot.it,
  // 2026-10-20: 131 queued runs on one runner). A PR the review would let
  // through is marked ready so its CI runs; a hold stays a draft. A
  // fix-worker PR (ADR 0047) only on "merge", and never one the model flagged.
  if (readiesOnVerdict(attempt, review.verdict)) {
    try {
      // Only the reviewed commit: a push during the review re-queued it, and
      // the next review decides about the new head.
      const current = await (deps.fetchPr ?? fetchPullRequestDetails)(token, ref, pr.number)
      if (!current || current.headSha !== details.headSha || current.merged || current.state === 'closed') {
        log.info('PR not marked ready: its head moved or it closed during the review', { reviewId: row.id })
      } else if (current.draft === true) {
        const ready = await (deps.markReady ?? markPullRequestReady)(token, ref, pr.number)
        if (ready.ok && !ready.alreadyReady) {
          await insertReviewEvent(db, row, {
            status: 'ok',
            label: READY_AFTER_REVIEW_LABEL,
            detail: `Opus review: ${VERDICT_LABEL[review.verdict]}`,
            dedupe: `review-ready:${row.id}:${details.headSha ?? nowIso}`,
            payload: { reviewId: row.id, verdict: review.verdict, headSha: details.headSha },
          })
        } else if (!ready.ok) {
          log.warn('PR not marked ready', { reviewId: row.id, message: ready.message })
        }
      }
    } catch (err) {
      // The verdict gates merges either way; readying the PR only starts CI.
      log.warn('PR not marked ready', { reviewId: row.id, err: err instanceof Error ? err.message : String(err) })
    }
  }

  return { outcome: 'completed', verdict: review.verdict }
}

// ─────────────────────────────────────────────────────────────────────────────
// A tick
// ─────────────────────────────────────────────────────────────────────────────

export async function runAgentPrReview(
  db: SupabaseClient,
  opts: ReviewRunOptions = {},
  deps: ReviewDeps = {},
): Promise<ReviewRunSummary> {
  const now = deps.now?.() ?? new Date()
  const nowIso = now.toISOString()
  const summary: ReviewRunSummary = {
    requeued: 0,
    gaveUp: 0,
    enqueued: 0,
    claimed: 0,
    completed: 0,
    skipped: 0,
    retried: 0,
    failed: 0,
    superseded: 0,
    verdicts: { merge: 0, fix_first: 0, hold: 0 },
    results: [],
  }

  const stale = await recoverStale(db, now)
  summary.requeued = stale.requeued
  summary.gaveUp = stale.gaveUp

  let rows: QueueRow[]
  if (opts.fixAttemptId) {
    const { data: attempt } = await db
      .from('fix_attempts')
      .select('id, project_id, report_id, pr_url')
      .eq('id', opts.fixAttemptId)
      .maybeSingle()
    const a = attempt as { id: string; project_id: string; report_id: string | null; pr_url: string | null } | null
    if (!a) return summary
    const res = await enqueueFixReview(
      db,
      { fixAttemptId: a.id, projectId: a.project_id, reportId: a.report_id, prUrl: a.pr_url },
      { force: opts.force === true, now },
    )
    if (res.queued) summary.enqueued++
    const { data } = await db
      .from('fix_reviews')
      .select(QUEUE_COLUMNS)
      .eq('fix_attempt_id', a.id)
      .eq('status', 'queued')
      .lte('queued_at', nowIso)
      .limit(1)
    rows = (data ?? []) as QueueRow[]
  } else {
    if (opts.backfill) {
      const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? BACKFILL_DEFAULT_LIMIT)), BACKFILL_MAX_LIMIT)
      summary.enqueued = await enqueueBackfill(db, limit, now)
    }
    // Re-reviews first: a row that already has a verdict was re-queued by a
    // push (a review follow-up, ADR 0032, or the author), and its verdict
    // decides a merge. A first-review backfill must not hold it for hours.
    const due = (rereview: boolean) => {
      const q = db.from('fix_reviews').select(QUEUE_COLUMNS).eq('status', 'queued').lte('queued_at', nowIso)
      return (rereview ? q.not('verdict', 'is', null) : q.is('verdict', null)).order('queued_at', { ascending: true }).limit(QUEUE_SCAN)
    }
    const [again, first] = await Promise.all([due(true), due(false)])
    const error = again.error ?? first.error
    if (error) throw new Error(`review queue read failed: ${error.message}`)
    rows = pickFairBatch([...((again.data ?? []) as QueueRow[]), ...((first.data ?? []) as QueueRow[])])
  }

  const outcomes = await mapWithConcurrency(rows, REVIEW_BATCH, async (row) => {
    try {
      return await reviewOne(db, row, deps)
    } catch (err) {
      // An unexpected failure leaves the row `running`; recoverStale retries it.
      const error = err instanceof Error ? err.message : String(err)
      log.warn('review failed unexpectedly (retried after the stale window)', { reviewId: row.id, err: error })
      return { outcome: 'retry', error } as ReviewOutcome
    }
  })

  outcomes.forEach((o, i) => {
    const row = rows[i]
    summary.results.push({ reviewId: row.id, fixAttemptId: row.fix_attempt_id, ...o })
    if (o.outcome === 'not_claimed') return
    summary.claimed++
    if (o.outcome === 'completed') {
      summary.completed++
      summary.verdicts[o.verdict]++
    } else if (o.outcome === 'skipped') summary.skipped++
    else if (o.outcome === 'retry') summary.retried++
    else if (o.outcome === 'superseded') summary.superseded++
    else summary.failed++
  })

  log.info('agent-pr-review.done', { ...summary, results: summary.results.length })
  return summary
}

const bodySchema = z
  .object({
    trigger: z.string().max(40).optional(),
    backfill: z.boolean().optional(),
    limit: z.number().int().min(1).max(BACKFILL_MAX_LIMIT).optional(),
    fixAttemptId: z.string().uuid().optional(),
    force: z.boolean().optional(),
  })
  .passthrough()

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }), { status: 405 })
  }
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const raw = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
  const parsed = bodySchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'bad body' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const body = parsed.data
  const db = getServiceClient()
  const trigger = body.trigger === 'cron' ? 'cron' : body.fixAttemptId || body.backfill ? 'manual' : 'http'
  const cronRun = await startCronRun(db, 'agent-pr-review', trigger)
  try {
    const summary = await runAgentPrReview(db, body)
    await cronRun.finish({
      rowsAffected: summary.completed,
      metadata: { ...summary, results: summary.results.slice(0, 20) },
    })
    return new Response(JSON.stringify({ ok: true, data: summary }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    await cronRun.fail(err)
    throw err
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('agent-pr-review', handler))
}
