// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * fix-verifier — Supabase Edge Function (verify_jwt = false, internal)
 *
 * Verified fixes (ADR 0035, Plan 024): an agent's PR merges on proof, not on
 * a model's verdict. Each tick this function:
 *
 *   1. picks cloud-agent fix attempts with an open PR whose latest completed
 *      Opus review is about the PR's head (`fix_attempts.commit_sha`) and that
 *      have no `fix_merge_gates` row for that head yet, or one older than
 *      10 minutes whose gates are not final; at most 10 a tick and 3 per app;
 *   2. reads the PR, its files (up to 300) and the check runs on its live
 *      head, computes the gates (`evaluateVerification`: review, CI, the
 *      host's fail-to-pass proof, protected paths, diff budget) and upserts
 *      the row for that head under a `run_id` claim; every write of the run
 *      is guarded on it;
 *   3. when gates 1 and 3 to 6 pass, runs the second review: the Opus review
 *      prompt and rules (`buildReviewPrompt`, `normalizeReview`) on a second
 *      model family through an OpenAI-compatible call, on the project's own
 *      OpenAI or OpenRouter key (ADR 0023/0031 order; never the platform key;
 *      no key reads "unavailable" and blocks automatic merge);
 *   4. when every gate passes, `verified_auto_merge` is on, today's automatic
 *      merges for the app are under its limit and the report is not fixed
 *      yet, merges through `gatedMergePullRequest` as a service caller
 *      (squash, pinned to the verified head; a service caller can never
 *      override a hold), finalizes the fix, and records the outcome in
 *      `auto_merge_state` and a fix event;
 *   5. watches every fix merged through Mushi in the last 72 hours: default-
 *      branch CI on the merge commit, a reopened report, and new reports whose
 *      stack names a changed file. Each signal is one `fix_regressions` row;
 *      the first two mark the fix regressed and, with `auto_revert = 'pr'`,
 *      open a revert PR when no later commit touched the fix's files
 *      (otherwise `not_safe`). A revert PR is never merged automatically.
 *
 * `{ fixAttemptId, force: true }` (POST /v1/admin/fixes/:id/verify) checks one
 * fix now, whatever its state.
 *
 * Wall clock: the repo assumes 150 s per edge invocation. Fixes are checked
 * side by side; a second review starts only in the first 40 s of a run and
 * aborts at 90 s. Merges of one app run one at a time, so the daily cap holds.
 *
 * Auth: `requireServiceRoleAuth`. Invoked by pg_cron `mushi-fix-verifier`
 * (migration 20261022010615, `4-54/10 * * * *`) and by
 * POST /v1/admin/fixes/:id/verify.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import type { ResolvedKey } from '../_shared/byok.ts'
import { estimateCallCostUsd } from '../_shared/pricing.ts'
import { extractLlmUsage, recordLlmUsage, servedModel } from '../_shared/llm-usage.ts'
import { sanitizeForLLM } from '../_shared/sanitize.ts'
import { mapWithConcurrency } from '../_shared/concurrency.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import {
  fetchPullRequestDetails,
  fetchPullRequestFiles,
  installationIdForAttempt,
  resolveProjectGithubToken,
  type GithubRepoRef,
  type PullRequestDetails,
  type PullRequestFile,
} from '../_shared/github.ts'
import { canonicalPrUrl, parsePullRequestUrl } from '../_shared/pr-substance.ts'
import { DISPATCHABLE_CLOUD_AGENTS } from '../_shared/agent-adapters.ts'
import { gatedMergePullRequest } from '../_shared/gated-merge.ts'
import { finalizeFixMerge } from '../_shared/fix-merge.ts'
import { reportFramePaths } from '../_shared/report-seeds.ts'
import {
  AGENT_PR_REVIEW_SYSTEM_PROMPT,
  agentPrReviewSchema,
  buildReviewDiff,
  buildReviewPrompt,
  normalizeReview,
  REVIEW_SKIP_REASONS,
  type AgentPrReviewRaw,
  type ReviewSkipReason,
  type ReviewVerdict,
} from '../_shared/fix-review.ts'
import {
  autoMergeDecision,
  ciFailedOnMerge,
  evaluateVerification,
  isDependencyReport,
  isVerificationFinal,
  pickVerifyBatch,
  readSecondJudge,
  REGRESSION_LABEL,
  REGRESSION_WATCH_MS,
  reportReopenedSince,
  reportsInChangedFiles,
  revertSafety,
  secondJudgeDue,
  signalRegresses,
  VERIFY_RECHECK_MS,
  type PrFile,
  type RegressionSignal,
  type SecondJudgeRecord,
  type SecondJudgeState,
  type VerifyCheckRunLike,
  type VerifySettings,
} from '../_shared/fix-verify.ts'
import {
  claimVerification,
  countAutoMergesToday,
  insertRegression,
  insertVerifyEvent,
  loadVerifySettings,
  markRegressed,
  notMigrated,
  resolveSecondJudgeKey,
  setRevertState,
  writeOwnVerification,
  type SecondJudgeKey,
} from '../_shared/fix-verify-db.ts'
import {
  compareCommits,
  fetchDefaultBranch,
  listCheckRunsWithOutput,
  openRevertPr,
  verifyWorkflowInstalled,
} from '../_shared/fix-verify-github.ts'

const log = rootLog.child('fix-verifier')

/** Open cloud-agent PRs read per tick to find the due ones. */
const CANDIDATE_SCAN = 200
/** Merged fixes watched per tick. */
export const WATCH_BATCH = 20
/** A second review starts only this early in a run, so it finishes inside the wall clock. */
export const JUDGE_START_DEADLINE_MS = 40_000
export const JUDGE_TIMEOUT_MS = 90_000
/** Thinking counts toward the cap; ~35k input + 8k output on gpt-5.4 ≈ $0.30 worst case. */
export const JUDGE_MAX_TOKENS = 8_000
/** New reports read per watched merge for the changed-file signal. */
const NEW_REPORTS_SCAN = 50

const ATTEMPT_COLUMNS = 'id, project_id, report_id, agent, status, pr_url, pr_number, pr_state, merged_at, commit_sha, branch, repo_id, ci_infra, summary'
const REVIEW_COLUMNS = 'fix_attempt_id, status, verdict, head_sha, reviewed_at, skip_reason, error'
const REPORT_COLUMNS = 'id, status, summary, description, category, severity, component, reproduction_steps, stage2_analysis'

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
  commit_sha: string | null
  branch: string | null
  repo_id: string | null
  ci_infra?: unknown
  summary?: string | null
}

interface ReviewRow {
  fix_attempt_id: string
  status: string | null
  verdict: ReviewVerdict | null
  head_sha: string | null
  reviewed_at: string | null
  skip_reason: string | null
  error: string | null
}

interface VerificationStateRow {
  fix_attempt_id: string
  head_sha: string
  gates: unknown
  passed: boolean
  auto_merge_state: string | null
  evaluated_at: string | null
  claimed_at: string | null
  run_id: string | null
}

export interface JudgeCallInput {
  key: ResolvedKey
  model: string
  system: string
  prompt: string
  abortSignal?: AbortSignal
}

export interface JudgeCallResult {
  object: AgentPrReviewRaw
  usage?: { promptTokens?: number; completionTokens?: number }
  response?: { modelId?: string }
}

export interface VerifierDeps {
  now?: () => Date
  /** Milliseconds since the run started; injectable so tests can pass the judge deadline. */
  elapsedMs?: () => number
  newRunId?: () => string
  resolveGithubToken?: (db: SupabaseClient, attempt: AttemptRow) => Promise<string | null>
  fetchPr?: (token: string, ref: GithubRepoRef, n: number) => Promise<PullRequestDetails | null>
  fetchFiles?: (token: string, ref: GithubRepoRef, n: number) => Promise<{ files: PullRequestFile[]; complete: boolean } | null>
  listChecks?: (token: string, ref: GithubRepoRef, sha: string) => Promise<VerifyCheckRunLike[] | null>
  workflowInstalled?: (token: string, ref: GithubRepoRef, branch: string | null) => Promise<boolean | null>
  resolveJudgeKey?: (db: SupabaseClient, projectId: string, settings: VerifySettings) => Promise<SecondJudgeKey>
  callJudge?: (input: JudgeCallInput) => Promise<JudgeCallResult>
  merge?: typeof gatedMergePullRequest
  finalize?: typeof finalizeFixMerge
  compare?: typeof compareCommits
  defaultBranch?: typeof fetchDefaultBranch
  openRevert?: typeof openRevertPr
}

export type VerifyOutcome =
  | { outcome: 'evaluated'; headSha: string; passed: boolean; autoMerge: string }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'not_claimed'; reason: string }
  | { outcome: 'superseded' }
  | { outcome: 'error'; error: string }

export interface VerifierRunSummary {
  candidates: number
  checked: number
  passed: number
  merged: number
  judged: number
  skipped: number
  errors: number
  watched: number
  regressions: number
  revertsOpened: number
  results: Array<{ fixAttemptId: string } & VerifyOutcome>
}

export interface VerifierRunOptions {
  fixAttemptId?: string
  force?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Default I/O
// ─────────────────────────────────────────────────────────────────────────────

async function defaultResolveGithubToken(db: SupabaseClient, attempt: AttemptRow): Promise<string | null> {
  const installationId = await installationIdForAttempt(db as never, attempt)
  return resolveProjectGithubToken(db as never, attempt.project_id, installationId)
}

async function defaultCallJudge(input: JudgeCallInput): Promise<JudgeCallResult> {
  // The AI SDK loads on the first model call, not at boot (ai-sdk.ts).
  const [{ generateObject }, { openAiProvider }] = await Promise.all([
    import('../_shared/ai-sdk.ts'),
    import('../_shared/openai-compat.ts'),
  ])
  // The key's own base URL: an OpenRouter key is never sent to api.openai.com.
  const openai = openAiProvider({ apiKey: input.key.key, ...(input.key.baseUrl ? { baseURL: input.key.baseUrl } : {}) })
  const result = await generateObject({
    model: openai(input.model),
    schema: agentPrReviewSchema,
    system: input.system,
    prompt: input.prompt,
    maxTokens: JUDGE_MAX_TOKENS,
    abortSignal: input.abortSignal,
  })
  return result as unknown as JudgeCallResult
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: which fixes are due
// ─────────────────────────────────────────────────────────────────────────────

interface Candidate {
  attempt: AttemptRow
  review: ReviewRow
  /** Has no row for the reviewed head yet (checked before re-checks). */
  fresh: boolean
  /** When the head was last checked (re-checks go oldest first). */
  evaluatedAt: string | null
}

async function readIn<T>(db: SupabaseClient, table: string, columns: string, ids: string[]): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from(table).select(columns).in('fix_attempt_id', ids.slice(i, i + 100))
    if (error) {
      if (notMigrated(error as { code?: string })) return []
      throw new Error(`${table} read failed: ${error.message}`)
    }
    out.push(...((data ?? []) as T[]))
  }
  return out
}

export async function loadCandidates(db: SupabaseClient, now: Date, opts: VerifierRunOptions = {}): Promise<Candidate[]> {
  let q = db.from('fix_attempts').select(ATTEMPT_COLUMNS)
  if (opts.fixAttemptId) {
    q = q.eq('id', opts.fixAttemptId)
  } else {
    q = q
      .in('agent', [...DISPATCHABLE_CLOUD_AGENTS])
      .not('pr_url', 'is', null)
      .in('pr_state', ['open', 'draft'])
      .is('merged_at', null)
      .order('created_at', { ascending: false })
      .limit(CANDIDATE_SCAN)
  }
  const { data, error } = await q
  if (error) throw new Error(`candidate read failed: ${error.message}`)
  const attempts = ((data ?? []) as AttemptRow[]).filter((a) => a.pr_url && !a.merged_at && DISPATCHABLE_CLOUD_AGENTS.has(a.agent))
  if (attempts.length === 0) return []
  const ids = attempts.map((a) => a.id)
  const [reviews, verifications] = await Promise.all([
    readIn<ReviewRow>(db, 'fix_reviews', REVIEW_COLUMNS, ids),
    readIn<VerificationStateRow>(db, 'fix_merge_gates', 'fix_attempt_id, head_sha, gates, passed, auto_merge_state, evaluated_at, claimed_at, run_id', ids),
  ])
  const reviewBy = new Map(reviews.map((r) => [r.fix_attempt_id, r]))
  const recheckBefore = new Date(now.getTime() - VERIFY_RECHECK_MS).toISOString()

  const fresh: Candidate[] = []
  const recheck: Candidate[] = []
  for (const attempt of attempts) {
    const review = reviewBy.get(attempt.id)
    // A verdict about the PR's head: the cached head (commit_sha) follows
    // pushes; an attempt with none yet takes the reviewed head.
    if (!review?.verdict || !review.head_sha) continue
    if (attempt.commit_sha && attempt.commit_sha !== review.head_sha) continue
    const row = verifications.find((v) => v.fix_attempt_id === attempt.id && v.head_sha === review.head_sha) ?? null
    if (!row) {
      fresh.push({ attempt, review, fresh: true, evaluatedAt: null })
      continue
    }
    if (opts.force && opts.fixAttemptId) {
      recheck.push({ attempt, review, fresh: false, evaluatedAt: row.evaluated_at })
      continue
    }
    if (isVerificationFinal(row)) continue
    if ((row.evaluated_at ?? '') > recheckBefore) continue
    recheck.push({ attempt, review, fresh: false, evaluatedAt: row.evaluated_at })
  }
  fresh.sort((a, b) => String(b.review.reviewed_at ?? '').localeCompare(String(a.review.reviewed_at ?? '')))
  recheck.sort((a, b) => String(a.evaluatedAt ?? '').localeCompare(String(b.evaluatedAt ?? '')))
  return [...fresh, ...recheck]
}

// ─────────────────────────────────────────────────────────────────────────────
// Steps 2 to 4: one fix
// ─────────────────────────────────────────────────────────────────────────────

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

/** Runs one function at a time per key: merges of one app never race the daily cap. */
class KeyedLock {
  private tails = new Map<string, Promise<unknown>>()
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.tails.set(key, next.catch(() => undefined))
    return next
  }
}

interface RunContext {
  db: SupabaseClient
  deps: VerifierDeps
  now: Date
  runStarted: number
  settings: Map<string, Promise<VerifySettings>>
  mergeLock: KeyedLock
  summary: VerifierRunSummary
}

function settingsFor(ctx: RunContext, projectId: string): Promise<VerifySettings> {
  let p = ctx.settings.get(projectId)
  if (!p) {
    p = loadVerifySettings(ctx.db, projectId).then((r) => {
      if (r.error) throw new Error(`verify settings read failed: ${r.error}`)
      return r.settings
    })
    ctx.settings.set(projectId, p)
  }
  return p
}

function elapsed(ctx: RunContext): number {
  return ctx.deps.elapsedMs?.() ?? Date.now() - ctx.runStarted
}

async function runSecondJudge(
  ctx: RunContext,
  input: {
    attempt: AttemptRow
    settings: VerifySettings
    stored: SecondJudgeRecord | null
    details: PullRequestDetails
    files: PullRequestFile[]
    filesComplete: boolean
    report: Record<string, unknown> | null
  },
): Promise<{ state: SecondJudgeState; record: SecondJudgeRecord | null }> {
  const { attempt, settings, stored } = input
  if (settings.verifySecondJudge === 'off') return { state: { kind: 'unavailable', reason: 'off' }, record: stored }
  if (stored && !secondJudgeDue(stored)) return { state: { kind: 'result', record: stored }, record: stored }
  if (elapsed(ctx) > JUDGE_START_DEADLINE_MS) {
    // Too late in this run to finish a model call: the next tick runs it.
    return { state: stored ? { kind: 'result', record: stored } : null, record: stored }
  }
  const resolved = await (ctx.deps.resolveJudgeKey ?? ((db, p, s) => resolveSecondJudgeKey(db, p, s)))(ctx.db, attempt.project_id, settings)
  if (!resolved.key) return { state: { kind: 'unavailable', reason: resolved.reason }, record: stored }

  const diff = buildReviewDiff(input.files, { complete: input.filesComplete })
  const prompt = buildReviewPrompt({
    report: reportContext(input.report),
    pr: {
      title: input.details.title ?? null,
      body: input.details.body ?? null,
      agent: attempt.agent,
      branch: input.details.headRef ?? attempt.branch,
      headSha: input.details.headSha,
    },
    // Gate 3 passed before the second review runs.
    ci: 'passed',
    diff,
    scrub: (t) => sanitizeForLLM(t).text,
  })
  const usageCtx = {
    functionName: 'fix-verifier',
    stage: 'second_review',
    projectId: attempt.project_id,
    reportId: attempt.report_id,
    model: resolved.model,
    keySource: resolved.key.source,
    startedAt: Date.now(),
  } as const
  const at = ctx.now.toISOString()
  ctx.summary.judged++
  let result: JudgeCallResult
  try {
    result = await (ctx.deps.callJudge ?? defaultCallJudge)({
      key: resolved.key,
      model: resolved.model,
      system: AGENT_PR_REVIEW_SYSTEM_PROMPT,
      prompt,
      abortSignal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    })
  } catch (err) {
    // A failed call can still have spent tokens: record it first.
    void recordLlmUsage(ctx.db, usageCtx, { error: err })
    const record: SecondJudgeRecord = {
      provider: resolved.provider,
      model: resolved.model,
      verdict: null,
      findings: [],
      summary: null,
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      at,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      tries: (stored?.verdict ? 0 : stored?.tries ?? 0) + 1,
    }
    return { state: { kind: 'result', record }, record }
  }
  void recordLlmUsage(ctx.db, usageCtx, { result })
  const review = normalizeReview(result.object, {
    ciFailed: false,
    diffTruncated: diff.truncated,
    sourceOmitted: diff.sourceOmitted.length > 0,
    fileListIncomplete: diff.fileListIncomplete,
  })
  const model = servedModel(result, resolved.model)
  const tokens = extractLlmUsage(result)
  const cost = estimateCallCostUsd(model, tokens.inputTokens ?? 0, tokens.outputTokens ?? 0)
  const record: SecondJudgeRecord = {
    provider: resolved.provider,
    model,
    verdict: review.verdict,
    findings: review.findings,
    summary: review.summary,
    input_tokens: tokens.inputTokens ?? null,
    output_tokens: tokens.outputTokens ?? null,
    cost_usd: Math.round(cost * 10_000) / 10_000,
    at,
  }
  return { state: { kind: 'result', record }, record }
}

export async function verifyOne(ctx: RunContext, candidate: Candidate): Promise<VerifyOutcome> {
  const { db, deps, now } = ctx
  const { attempt, review } = candidate
  const nowIso = now.toISOString()

  const pr = parsePullRequestUrl(canonicalPrUrl(attempt.pr_url) ?? '')
  if (!pr) return { outcome: 'skipped', reason: 'pr_url_unreadable' }
  const ref: GithubRepoRef = { owner: pr.owner, repo: pr.repo }
  const token = await (deps.resolveGithubToken ?? defaultResolveGithubToken)(db, attempt)
  if (!token) return { outcome: 'skipped', reason: 'no_github_token' }
  const details = await (deps.fetchPr ?? fetchPullRequestDetails)(token, ref, pr.number)
  if (!details?.headSha) return { outcome: 'skipped', reason: 'pr_not_found' }
  if (details.merged || details.state !== 'open') return { outcome: 'skipped', reason: 'pr_not_open' }
  const headSha = details.headSha

  const runId = deps.newRunId?.() ?? crypto.randomUUID()
  const claim = await claimVerification(
    db,
    {
      fixAttemptId: attempt.id,
      projectId: attempt.project_id,
      reportId: attempt.report_id,
      repo: `${pr.owner}/${pr.repo}`.toLowerCase(),
      prNumber: pr.number,
      headSha,
    },
    runId,
    now,
  )
  if (!claim.claimed) return { outcome: 'not_claimed', reason: claim.reason === 'error' ? `claim failed: ${claim.error}` : claim.reason }
  const rowId = claim.row.id
  const wasPassed = claim.row.passed === true

  try {
    const [settings, listed, checks, workflow] = await Promise.all([
      settingsFor(ctx, attempt.project_id),
      (deps.fetchFiles ?? ((t, r, n) => fetchPullRequestFiles(t, r, n, { maxPages: 3 })))(token, ref, pr.number),
      (deps.listChecks ?? listCheckRunsWithOutput)(token, ref, headSha),
      (deps.workflowInstalled ?? verifyWorkflowInstalled)(token, ref, details.baseRef),
    ])
    let report: Record<string, unknown> | null = null
    if (attempt.report_id) {
      const { data } = await db.from('reports').select(REPORT_COLUMNS).eq('id', attempt.report_id).maybeSingle()
      report = (data as Record<string, unknown> | null) ?? null
    }
    const files: PrFile[] = (listed?.files ?? []).map((f) => ({ ...f, previous_filename: f.previousFilename ?? null }))
    const reviewInput = {
      status: review.status,
      verdict: review.verdict,
      headSha: review.head_sha,
      reason: review.skip_reason && review.skip_reason in REVIEW_SKIP_REASONS ? REVIEW_SKIP_REASONS[review.skip_reason as ReviewSkipReason] : review.error,
    }
    const stored = readSecondJudge(claim.row.second_judge)
    const base = {
      headSha,
      review: reviewInput,
      checks: checks ?? [],
      ciInfra: attempt.ci_infra,
      workflowInstalled: workflow,
      files,
      filesComplete: listed ? listed.complete : false,
      settings,
      allowLockfiles: isDependencyReport(report as { summary?: string; description?: string; component?: string } | null),
      now,
    }
    let evaluation = evaluateVerification({ ...base, secondJudge: stored ? { kind: 'result', record: stored } : null })
    let record = stored
    if (evaluation.othersPass) {
      const judged = await runSecondJudge(ctx, { attempt, settings, stored, details, files: listed?.files ?? [], filesComplete: base.filesComplete, report })
      record = judged.record
      evaluation = evaluateVerification({ ...base, secondJudge: judged.state })
    }
    const verifyEvidence = evaluation.gates.find((g) => g.id === 'fail_to_pass')?.evidence as { baseSha?: string | null } | undefined

    const saved = await writeOwnVerification(db, rowId, runId, {
      gates: evaluation.gates,
      passed: evaluation.passed,
      second_judge: record,
      base_sha: verifyEvidence?.baseSha ?? null,
      report_id: attempt.report_id,
      evaluated_at: nowIso,
    })
    if (!saved) return { outcome: 'superseded' }
    if (evaluation.passed && !wasPassed) {
      await insertVerifyEvent(db, { fixAttemptId: attempt.id, projectId: attempt.project_id }, {
        kind: 'verified',
        status: 'ok',
        label: 'Verified: every check passed',
        detail: evaluation.gates.map((g) => g.label).join(' · '),
        dedupe: `verified:${attempt.id}:${headSha}`,
        payload: { headSha, gates: evaluation.gates.map((g) => ({ id: g.id, status: g.status })) },
      }).catch((err) => log.warn('verified event not written', { fixAttemptId: attempt.id, err: String(err) }))
    }

    // Step 4: merge, one app at a time so the daily cap holds.
    const autoMerge = await ctx.mergeLock.run(attempt.project_id, async () => {
      const mergedToday = evaluation.passed && settings.verifiedAutoMerge ? await countAutoMergesToday(db, attempt.project_id, now) : 0
      const decision = autoMergeDecision({
        passed: evaluation.passed,
        settings,
        mergedToday,
        reportStatus: (report?.status as string | null | undefined) ?? null,
        prOpen: details.state === 'open' && !details.merged,
      })
      if (!decision.merge) {
        await writeOwnVerification(db, rowId, runId, { auto_merge_state: decision.state, auto_merge_detail: decision.detail, run_id: null })
        return decision.state
      }
      await writeOwnVerification(db, rowId, runId, { auto_merge_state: 'eligible', auto_merge_detail: decision.detail })
      return mergeVerified(ctx, { attempt, token, ref, prNumber: pr.number, details, headSha, rowId, runId, report })
    })
    if (evaluation.passed) ctx.summary.passed++
    return { outcome: 'evaluated', headSha, passed: evaluation.passed, autoMerge }
  } catch (err) {
    // Release the claim so the next tick can take the row; the row keeps its last gates.
    await writeOwnVerification(db, rowId, runId, { run_id: null }).catch(() => false)
    throw err
  }
}

async function mergeVerified(
  ctx: RunContext,
  m: {
    attempt: AttemptRow
    token: string
    ref: GithubRepoRef
    prNumber: number
    details: PullRequestDetails
    headSha: string
    rowId: string
    runId: string
    report: Record<string, unknown> | null
  },
): Promise<string> {
  const { db, deps } = ctx
  const fail = async (detail: string) => {
    await writeOwnVerification(db, m.rowId, m.runId, { auto_merge_state: 'failed', auto_merge_detail: detail.slice(0, 500), run_id: null })
    return 'failed'
  }
  const summary = (m.report?.summary as string | null | undefined) ?? m.attempt.summary ?? m.details.title ?? null
  let outcome: Awaited<ReturnType<typeof gatedMergePullRequest>>
  try {
    outcome = await (deps.merge ?? gatedMergePullRequest)(db, {
      projectId: m.attempt.project_id,
      token: m.token,
      ref: m.ref,
      number: m.prNumber,
      fixAttemptId: m.attempt.id,
      pull: { headSha: m.details.headSha, baseRepoId: m.details.baseRepoId ?? null, baseRepoFullName: m.details.baseRepoFullName ?? null },
      caller: 'service',
      reason: 'verified_auto_merge',
      expectedHeadSha: m.headSha,
      // Ignored for a service caller; a service merge can never override.
      override: false,
      overrideReason: null,
      confirmPendingReview: false,
      authMethod: 'service',
      role: null,
      merge: { mergeMethod: 'squash', commitTitle: summary ? `fix: ${String(summary).slice(0, 72)}` : undefined },
    })
  } catch (err) {
    return fail(`GitHub did not merge: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`)
  }
  if (!outcome.ok) return fail(outcome.message)
  if (!outcome.result.merged || outcome.result.alreadyMerged) {
    return fail(outcome.result.alreadyMerged ? 'The pull request was already merged.' : outcome.result.message ?? 'GitHub refused the merge.')
  }
  const mergedAt = ctx.now.toISOString()
  const mergeSha = outcome.result.sha ?? null
  await writeOwnVerification(db, m.rowId, m.runId, {
    auto_merge_state: 'merged',
    auto_merge_detail: 'Merged on proof: every check passed on this commit.',
    merged_at: mergedAt,
    ...(mergeSha ? { merge_sha: mergeSha } : {}),
    run_id: null,
  })
  ctx.summary.merged++
  try {
    await (deps.finalize ?? finalizeFixMerge)(db as never, {
      id: m.attempt.id,
      project_id: m.attempt.project_id,
      report_id: m.attempt.report_id ?? '',
      agent: m.attempt.agent,
      branch: m.attempt.branch,
      commit_sha: m.headSha,
      pr_url: m.attempt.pr_url,
      pr_number: m.prNumber,
      merged_at: null,
    }, {
      prUrl: canonicalPrUrl(m.attempt.pr_url) ?? m.attempt.pr_url ?? '',
      prNumber: m.prNumber,
      repository: `${m.ref.owner}/${m.ref.repo}`,
      source: 'verified_auto_merge',
    })
  } catch (err) {
    // GitHub merged; the webhook or ci-sync finishes the bookkeeping.
    log.warn('finalize after a verified merge failed', { fixAttemptId: m.attempt.id, err: err instanceof Error ? err.message : String(err) })
  }
  await insertVerifyEvent(db, { fixAttemptId: m.attempt.id, projectId: m.attempt.project_id }, {
    kind: 'auto_merged',
    status: 'ok',
    label: 'Merged on proof',
    detail: `Every check passed on ${m.headSha.slice(0, 7)}; Mushi squash-merged it.`,
    dedupe: `auto_merged:${m.attempt.id}:${m.headSha}`,
    payload: { headSha: m.headSha, mergeSha },
  }).catch((err) => log.warn('auto_merged event not written', { fixAttemptId: m.attempt.id, err: String(err) }))
  return 'merged'
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: regression watch
// ─────────────────────────────────────────────────────────────────────────────

interface MergedRow {
  fix_attempt_id: string
  project_id: string
  head_sha: string
  merge_sha: string
  merged_at: string
}

export async function watchRegressions(ctx: RunContext): Promise<void> {
  const { db, deps, now } = ctx
  const since = new Date(now.getTime() - REGRESSION_WATCH_MS).toISOString()
  const { data, error } = await db
    .from('fix_merge_gates')
    .select('fix_attempt_id, project_id, head_sha, merge_sha, merged_at')
    .not('merge_sha', 'is', null)
    .gte('merged_at', since)
    .order('merged_at', { ascending: false })
    .limit(WATCH_BATCH * 2)
  if (error) {
    if (notMigrated(error as { code?: string })) return
    throw new Error(`regression watch read failed: ${error.message}`)
  }
  // One merge per fix attempt (its newest).
  const seen = new Set<string>()
  const merges = ((data ?? []) as MergedRow[]).filter((r) => (seen.has(r.fix_attempt_id) ? false : (seen.add(r.fix_attempt_id), true))).slice(0, WATCH_BATCH)
  for (const merge of merges) {
    try {
      await watchOne(ctx, merge)
      ctx.summary.watched++
    } catch (err) {
      ctx.summary.errors++
      log.warn('regression watch failed for one fix', { fixAttemptId: merge.fix_attempt_id, err: err instanceof Error ? err.message : String(err) })
    }
  }
}

async function watchOne(ctx: RunContext, merge: MergedRow): Promise<void> {
  const { db, deps, now } = ctx
  const { data: existing, error: regErr } = await db
    .from('fix_regressions')
    .select('id, signal, revert_state, revert_pr_url')
    .eq('fix_attempt_id', merge.fix_attempt_id)
  if (regErr) throw new Error(`fix_regressions read failed: ${regErr.message}`)
  const recorded = (existing ?? []) as Array<{ id: string; signal: string; revert_state: string; revert_pr_url: string | null }>
  const has = (s: RegressionSignal) => recorded.some((r) => r.signal === s)
  if (has('ci_failed_on_merge') && has('report_reopened') && has('new_report_in_changed_file')) return

  const { data: attemptData } = await db.from('fix_attempts').select(ATTEMPT_COLUMNS).eq('id', merge.fix_attempt_id).maybeSingle()
  const attempt = (attemptData as AttemptRow | null) ?? null
  if (!attempt?.pr_url) return
  const pr = parsePullRequestUrl(canonicalPrUrl(attempt.pr_url) ?? '')
  if (!pr) return
  const ref: GithubRepoRef = { owner: pr.owner, repo: pr.repo }
  const token = await (deps.resolveGithubToken ?? defaultResolveGithubToken)(db, attempt)
  if (!token) return

  const found: Array<{ signal: RegressionSignal; detail: string | null; evidence: Record<string, unknown> | null }> = []
  if (!has('ci_failed_on_merge')) {
    const checks = await (deps.listChecks ?? listCheckRunsWithOutput)(token, ref, merge.merge_sha)
    const ci = ciFailedOnMerge(checks ?? [], { now })
    if (ci.failed) found.push({ signal: 'ci_failed_on_merge', detail: ci.detail, evidence: ci.evidence })
  }
  if (attempt.report_id && !has('report_reopened')) {
    const { data } = await db.from('reports').select('id, status, reopened_at').eq('id', attempt.report_id).maybeSingle()
    const report = (data as { status?: string | null; reopened_at?: string | null } | null) ?? null
    if (reportReopenedSince(report, merge.merged_at)) {
      found.push({ signal: 'report_reopened', detail: 'The report was reopened after the merge.', evidence: { reportId: attempt.report_id, status: report?.status ?? null, reopenedAt: report?.reopened_at ?? null } })
    }
  }

  // The PR's files: for the changed-file signal and for a revert.
  let prFiles: string[] | null = null
  const loadPrFiles = async (): Promise<string[] | null> => {
    if (prFiles) return prFiles
    const listed = await (deps.fetchFiles ?? ((t, r, n) => fetchPullRequestFiles(t, r, n, { maxPages: 3 })))(token, ref, pr.number)
    if (!listed || !listed.complete) return null
    prFiles = [...new Set(listed.files.flatMap((f) => (f.previousFilename ? [f.filename, f.previousFilename] : [f.filename])))]
    return prFiles
  }

  if (!has('new_report_in_changed_file')) {
    let q = db
      .from('reports')
      .select('id, custom_metadata, console_logs')
      .eq('project_id', merge.project_id)
      .gt('created_at', merge.merged_at)
      .order('created_at', { ascending: true })
      .limit(NEW_REPORTS_SCAN)
    if (attempt.report_id) q = q.neq('id', attempt.report_id)
    const { data: newReports } = await q
    const withFrames = ((newReports ?? []) as Array<{ id: string; custom_metadata: unknown; console_logs: unknown }>)
      .map((r) => ({ id: r.id, framePaths: reportFramePaths(r as never) }))
      .filter((r) => r.framePaths.length > 0)
    if (withFrames.length > 0) {
      const files = await loadPrFiles()
      const hits = files ? reportsInChangedFiles(withFrames, files) : []
      if (hits.length > 0) {
        found.push({
          signal: 'new_report_in_changed_file',
          detail: `${hits.length} new report${hits.length === 1 ? '' : 's'} point${hits.length === 1 ? 's' : ''} at ${hits[0].files[0]}.`,
          evidence: { reports: hits.slice(0, 10) },
        })
      }
    }
  }
  if (found.length === 0) return

  const settings = await settingsFor(ctx, merge.project_id)
  let revertUrl = recorded.find((r) => r.revert_state === 'pr_opened')?.revert_pr_url ?? null
  for (const signal of found) {
    const row = await insertRegression(db, {
      fixAttemptId: merge.fix_attempt_id,
      projectId: merge.project_id,
      mergeSha: merge.merge_sha,
      signal: signal.signal,
      detail: signal.detail,
      evidence: signal.evidence,
    })
    if (!row) continue
    ctx.summary.regressions++
    const regresses = signalRegresses(signal.signal)
    if (regresses) await markRegressed(db, merge.fix_attempt_id, now.toISOString())
    await insertVerifyEvent(db, { fixAttemptId: merge.fix_attempt_id, projectId: merge.project_id }, {
      kind: 'regressed',
      status: regresses ? 'fail' : 'pending',
      label: REGRESSION_LABEL[signal.signal],
      detail: signal.detail,
      dedupe: `regressed:${merge.fix_attempt_id}:${signal.signal}`,
      payload: { signal: signal.signal, mergeSha: merge.merge_sha },
    })
    if (!regresses) continue
    if (settings.autoRevert === 'off') {
      await setRevertState(db, row.id, 'off', null)
      continue
    }
    if (revertUrl) {
      await setRevertState(db, row.id, 'pr_opened', revertUrl)
      continue
    }
    revertUrl = await tryRevert(ctx, { attempt, token, ref, merge, regressionId: row.id, signal: signal.signal, detail: signal.detail, evidence: signal.evidence, loadPrFiles })
  }
}

async function tryRevert(
  ctx: RunContext,
  r: {
    attempt: AttemptRow
    token: string
    ref: GithubRepoRef
    merge: MergedRow
    regressionId: string
    signal: RegressionSignal
    detail: string | null
    evidence: Record<string, unknown> | null
    loadPrFiles: () => Promise<string[] | null>
  },
): Promise<string | null> {
  const { db, deps } = ctx
  const why = (detail: string) => ({ detail, evidence: r.evidence })
  try {
    const files = await r.loadPrFiles()
    if (!files || files.length === 0) {
      await setRevertState(db, r.regressionId, 'not_safe', null, why('Mushi could not list every file the fix changed.'))
      return null
    }
    const defaultBranch = await (deps.defaultBranch ?? fetchDefaultBranch)(r.token, r.ref)
    if (!defaultBranch) {
      await setRevertState(db, r.regressionId, 'failed', null, why('Mushi could not read the default branch.'))
      return null
    }
    const compare = await (deps.compare ?? compareCommits)(r.token, r.ref, r.merge.merge_sha, defaultBranch)
    const safety = revertSafety(files, compare)
    if (!safety.safe) {
      await setRevertState(db, r.regressionId, 'not_safe', null, why(safety.reason))
      return null
    }
    const title = (r.attempt.summary ?? '').trim() || `fix #${r.attempt.pr_number ?? ''}`.trim()
    const pr = await (deps.openRevert ?? openRevertPr)({
      token: r.token,
      ref: r.ref,
      defaultBranch,
      mergeSha: r.merge.merge_sha,
      paths: files,
      title,
      signal: r.signal,
      detail: r.detail,
      prUrl: canonicalPrUrl(r.attempt.pr_url) ?? r.attempt.pr_url,
    })
    await setRevertState(db, r.regressionId, 'pr_opened', pr.url)
    ctx.summary.revertsOpened++
    await insertVerifyEvent(db, { fixAttemptId: r.attempt.id, projectId: r.attempt.project_id }, {
      kind: 'revert_opened',
      status: 'pending',
      label: 'Revert PR opened',
      detail: `${pr.url} (Mushi never merges a revert on its own)`,
      dedupe: `revert_opened:${r.attempt.id}:${r.merge.merge_sha}`,
      payload: { url: pr.url, number: pr.number, branch: pr.branch, signal: r.signal },
    })
    return pr.url
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    await setRevertState(db, r.regressionId, 'failed', null, why(message)).catch(() => undefined)
    log.warn('revert PR not opened', { fixAttemptId: r.attempt.id, err: message })
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A tick
// ─────────────────────────────────────────────────────────────────────────────

export async function runFixVerifier(db: SupabaseClient, opts: VerifierRunOptions = {}, deps: VerifierDeps = {}): Promise<VerifierRunSummary> {
  const now = deps.now?.() ?? new Date()
  const summary: VerifierRunSummary = {
    candidates: 0,
    checked: 0,
    passed: 0,
    merged: 0,
    judged: 0,
    skipped: 0,
    errors: 0,
    watched: 0,
    regressions: 0,
    revertsOpened: 0,
    results: [],
  }
  const ctx: RunContext = { db, deps, now, runStarted: Date.now(), settings: new Map(), mergeLock: new KeyedLock(), summary }

  const candidates = await loadCandidates(db, now, opts)
  summary.candidates = candidates.length
  const batch = opts.fixAttemptId ? candidates.slice(0, 1) : pickVerifyBatch(candidates.map((c) => ({ ...c, project_id: c.attempt.project_id })))
  const outcomes = await mapWithConcurrency(batch, batch.length || 1, async (c) => {
    try {
      return await verifyOne(ctx, c)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.warn('verification failed (retried next tick)', { fixAttemptId: c.attempt.id, err: error })
      return { outcome: 'error', error } as VerifyOutcome
    }
  })
  outcomes.forEach((o, i) => {
    summary.results.push({ fixAttemptId: batch[i].attempt.id, ...o })
    if (o.outcome === 'evaluated') summary.checked++
    else if (o.outcome === 'error') summary.errors++
    else summary.skipped++
  })

  // The watch runs on cron ticks, not on a single fix's re-check.
  if (!opts.fixAttemptId) await watchRegressions(ctx)

  log.info('fix-verifier.done', { ...summary, results: summary.results.length })
  return summary
}

const bodySchema = z
  .object({
    trigger: z.string().max(40).optional(),
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
  const trigger = body.trigger === 'cron' ? 'cron' : body.fixAttemptId ? 'manual' : 'http'
  const cronRun = await startCronRun(db, 'fix-verifier', trigger)
  try {
    const summary = await runFixVerifier(db, body)
    await cronRun.finish({
      rowsAffected: summary.checked + summary.regressions,
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
  Deno.serve(withSentry('fix-verifier', handler))
}
