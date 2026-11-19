/**
 * FILE: packages/server/supabase/functions/_shared/report-pipeline-trail.ts
 * PURPOSE: One report's trip through the pipeline as a row of stages, for
 *          the report page's Pipeline strip and the unified timeline:
 *
 *            Reported → Quick check → Diagnosis → Fix → PR → CI → Merged → Live
 *
 *          Each stage says its state (the console's RunStatus words: passed,
 *          running, waiting, slow, failed, idle, cancelled), when it started
 *          and ended, how long it took, what went wrong in one plain line
 *          (raw text kept apart, screened, for a Details disclosure), and
 *          which retry the console can offer from that spot.
 *
 *          Pure: the route reads the rows, this file decides. Times come from
 *          the moment a stage was entered (the queue job's created_at /
 *          started_at, the fix's created_at, the PR's open time), never from
 *          `updated_at`, as in pipeline-view.ts.
 *
 *          The processing_queue only ever holds the `stage1` job (fast-filter,
 *          which hands off to classify-report). Every later stage comes from
 *          the latest fix attempt and deploy_observations.
 *
 *          `triageRetryDecision` is the report-level rule on top of
 *          queue-retry-policy.ts (which the DLQ keeps): a fast-filter that
 *          answered 200 marks its job completed even when classify-report
 *          failed afterwards, so a completed job whose report is still not
 *          diagnosed can be retried here.
 */

import { sanitizeLlmError } from './llm-error-sanitize.ts'
import { humanizeFixError } from './humanize-error.ts'
import { STUCK_AFTER_MS } from './queue-retry-policy.ts'

export type TrailState = 'passed' | 'running' | 'waiting' | 'slow' | 'failed' | 'idle' | 'cancelled'

export type TrailStageId = 'received' | 'triage' | 'diagnosis' | 'fix' | 'pr' | 'ci' | 'merge' | 'deploy'

export const TRAIL_STAGES: ReadonlyArray<{ id: TrailStageId; label: string }> = [
  { id: 'received', label: 'Reported' },
  { id: 'triage', label: 'Quick check' },
  { id: 'diagnosis', label: 'Diagnosis' },
  { id: 'fix', label: 'Fix' },
  { id: 'pr', label: 'PR' },
  { id: 'ci', label: 'CI' },
  { id: 'merge', label: 'Merged' },
  { id: 'deploy', label: 'Live' },
]

/** Which existing route a stage's retry calls. */
export type TrailRetryKind = 'triage' | 'dispatch' | 'ci_repair'

export interface TrailRetry {
  kind: TrailRetryKind
  allowed: boolean
  /** Why it is not allowed (shown on the disabled button), or null. */
  reason: string | null
}

export interface TrailStage {
  id: TrailStageId
  label: string
  state: TrailState
  startedAt: string | null
  endedAt: string | null
  /** Measured duration; for an open stage, time so far (to `now`). */
  durationMs: number | null
  /** One plain line on what went wrong, or null. */
  problem: string | null
  /** Raw, screened text behind "Details", or null. */
  detail: string | null
  attempts: { used: number; max: number } | null
  retry: TrailRetry | null
  /**
   * The stage did not run and did not need to (a confident quick check needs no full
   * diagnosis; a report a person sorted needs no triage run). Never the "current" stage.
   */
  skipped: boolean
  /** One short line for a skipped or passed stage ("Not needed: the quick check was confident."), or null. */
  note: string | null
}

export interface TrailJob {
  id: string
  stage: string
  status: string
  attempts: number
  maxAttempts: number
  /** Screened. */
  lastError: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface ReportTrail {
  stages: TrailStage[]
  /** The first stage not passed (where the report is now), or null when live. */
  current: TrailStageId | null
  /** The first failed stage, or null. */
  failing: TrailStageId | null
  jobs: TrailJob[]
}

// ── Input rows (columns the route selects) ──────────────────────────────────

export interface TrailReportRow {
  id: string
  status: string | null
  created_at: string
  processing_error: string | null
  processing_attempts: number | null
  stage1_classification: unknown
  stage1_latency_ms: number | null
  stage2_analysis: unknown
  stage2_latency_ms: number | null
}

/** Columns the route reads from reports, kept here so a test can pin them (no `classified_at`: not a column). */
export const TRAIL_REPORT_COLUMNS =
  'id, project_id, status, created_at, processing_error, processing_attempts, stage1_classification, stage1_latency_ms, stage2_analysis, stage2_latency_ms'

export interface TrailQueueRow {
  id: string
  stage: string
  status: string
  attempts: number | null
  max_attempts: number | null
  last_error: string | null
  scheduled_at?: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export const TRAIL_QUEUE_COLUMNS = 'id, stage, status, attempts, max_attempts, last_error, scheduled_at, created_at, started_at, completed_at'

export interface TrailFixRow {
  id: string
  status: string | null
  agent: string | null
  error: string | null
  failure_category?: string | null
  pr_url: string | null
  pr_number: number | null
  pr_state: string | null
  check_run_status: string | null
  check_run_conclusion: string | null
  check_run_updated_at: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  merged_at: string | null
}

export const TRAIL_FIX_COLUMNS =
  'id, status, agent, error, failure_category, pr_url, pr_number, pr_state, check_run_status, check_run_conclusion, check_run_updated_at, created_at, started_at, completed_at, merged_at'

export interface TrailDeployRow {
  observed_at: string
  observed_version: string | null
  ok: boolean | null
}

export interface TrailInput {
  report: TrailReportRow
  queue: TrailQueueRow[]
  fix: TrailFixRow | null
  deploys: TrailDeployRow[]
  now: Date
}

// ── Plain words ─────────────────────────────────────────────────────────────

const DETAIL_MAX = 600

/** Screen and cut raw error text before it leaves the server. */
export function screenDetail(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  const clean = sanitizeLlmError(raw).trim()
  return clean.length > DETAIL_MAX ? `${clean.slice(0, DETAIL_MAX)}…` : clean
}

/**
 * A triage error (queue `last_error` or `reports.processing_error`) in one
 * plain line. Order matters: a budget 402 says "budget", not "crashed".
 */
export function plainTriageError(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  const m = raw.toLowerCase()
  if (/stage2 handoff failed/.test(m)) return 'The quick check worked, but handing the report to the full diagnosis failed.'
  if (/budget|spend cap|spend limit|quota|\b402\b|insufficient_quota|credit/.test(m)) return 'The AI budget or quota is used up, so triage stopped.'
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[ _-]?api[ _-]?key|incorrect api key|authentication/.test(m)) return 'The AI key or the internal worker token was refused.'
  if (/\b429\b|rate.?limit|too many requests/.test(m)) return 'The AI provider asked Mushi Mushi to slow down (rate limit).'
  if (/time(d)?[ _-]?out|timeout|abort|idle/.test(m)) return 'Triage took too long and was stopped.'
  if (/stage1_llm_unavailable|no (ai|llm) key|no key|missing key|not configured/.test(m)) return 'No AI model was available for triage.'
  if (/fetch failed|network|econn|enotfound|dns|connection (refused|reset)/.test(m)) return 'Mushi Mushi could not reach its triage worker.'
  if (/\b404\b|not found/.test(m)) return 'The triage worker could not find this report.'
  if (/\b5\d\d\b|unhandled|internal server error|stage1_unhandled/.test(m)) return 'The triage worker crashed on this report.'
  return 'Triage failed for a reason Mushi Mushi does not recognise yet.'
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const lowerFirst = (t: string) => (t ? `${t[0]!.toLowerCase()}${t.slice(1)}` : t)

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

function span(start: string | null, end: string | null, nowMs: number): number | null {
  const s = ms(start)
  if (s == null) return null
  const e = ms(end) ?? nowMs
  return Math.max(0, e - s)
}

const isActiveJob = (status: string) => status === 'pending' || status === 'processing' || status === 'running'
const isFailedJob = (status: string) => status === 'failed' || status === 'dead_letter'

/** The stage-1 job (the queue holds one per report and stage). */
export function stage1Job(queue: readonly TrailQueueRow[]): TrailQueueRow | null {
  const rows = queue.filter((q) => q.stage === 'stage1')
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
}

function jobSince(job: TrailQueueRow): string | null {
  return job.status === 'pending' ? (job.scheduled_at ?? job.created_at) : (job.started_at ?? job.scheduled_at ?? job.created_at)
}

const FIX_ACTIVE = new Set(['queued', 'pending', 'running', 'in_progress', 'dispatched', 'claimed'])
const FIX_FAILED = new Set(['failed', 'error', 'errored', 'cancelled', 'timed_out'])
const CI_RED = new Set(['failure', 'timed_out', 'action_required', 'startup_failure'])
const CI_ACTIVE = new Set(['queued', 'in_progress', 'pending', 'requested', 'waiting'])
/** Merged with deploys recorded for the app, and none seen after this long: slow. */
const DEPLOY_SLOW_MS = 24 * 3600_000
/** Diagnosis still running after the quick check passed this long ago: treat as stuck. */
const DIAGNOSIS_STUCK_MS = STUCK_AFTER_MS

/**
 * Statuses that mean the report was triaged, by the pipeline or by a person (the admin's
 * isReportClassified set, plus dispatched / dismissed / completed). A report in one of
 * these is never "stuck in triage", and re-running triage on it would overwrite its
 * category and severity, a person's choice included.
 */
export const TRIAGED_STATUSES: ReadonlySet<string> = new Set(['classified', 'triaged', 'grouped', 'dispatched', 'fixing', 'fixed', 'verified', 'resolved', 'completed', 'dismissed'])

const statusOf = (r: Pick<TrailReportRow, 'status'>) => (r.status ?? '').toLowerCase()

// ── Retry rule ──────────────────────────────────────────────────────────────

export type TriageRetryDecision =
  | { kind: 'retry'; job: TrailQueueRow | null }
  | { kind: 'already'; reason: string }
  | { kind: 'deny'; reason: string }

/**
 * May a person re-run triage (fast-filter → classify-report) for this report now?
 *
 *   diagnosed (stage 2 stored)                    deny: it would spend AI budget again
 *   triaged status (TRIAGED_STATUSES)             deny: it would overwrite the triage
 *   quota_exceeded                                deny: it would stop at the quota again
 *   job pending / processing, fresh               already: the worker is on it
 *   job failed / dead_letter                      retry
 *   job pending / processing, waited 15 min       retry (stuck)
 *   job completed, report not diagnosed           retry (classify-report failed after a 200)
 *   no job, report never triaged                  retry (a job is created)
 */
export function triageRetryDecision(report: TrailReportRow, queue: readonly TrailQueueRow[], nowMs: number): TriageRetryDecision {
  const quick = report.stage1_classification != null
  const deep = report.stage2_analysis != null
  if (deep) {
    return { kind: 'deny', reason: 'This report is already diagnosed. Running triage again would spend AI budget and could overwrite it.' }
  }
  if (TRIAGED_STATUSES.has(statusOf(report))) {
    return { kind: 'deny', reason: 'This report is already triaged. Running triage again would spend AI budget and could overwrite its category and severity.' }
  }
  if (statusOf(report) === 'quota_exceeded') {
    return { kind: 'deny', reason: "This plan's diagnosis quota is used up. Raise it on Billing, then retry." }
  }
  const job = stage1Job(queue)
  if (job && isActiveJob(job.status)) {
    const since = ms(jobSince(job))
    if (since == null || nowMs - since < STUCK_AFTER_MS) {
      return { kind: 'already', reason: 'Triage is running for this report now. Try again only if it is still running in 15 minutes.' }
    }
    return { kind: 'retry', job }
  }
  if (job && isFailedJob(job.status)) return { kind: 'retry', job }
  if (quick && !deep && !report.processing_error) {
    // Stage 1 done, the diagnosis is on its way: give it the same 15 minutes.
    const end = ms(job?.completed_at) ?? ms(report.created_at)
    if (end != null && nowMs - end < DIAGNOSIS_STUCK_MS) {
      return { kind: 'already', reason: 'The diagnosis is running now. Try again only if it has not finished in 15 minutes.' }
    }
  }
  return { kind: 'retry', job }
}

// ── Builder ─────────────────────────────────────────────────────────────────

export function buildReportTrail(input: TrailInput): ReportTrail {
  const { report, fix } = input
  const nowMs = input.now.getTime()
  const job = stage1Job(input.queue)
  const quick = report.stage1_classification != null
  const deep = report.stage2_analysis != null
  const decision = triageRetryDecision(report, input.queue, nowMs)
  const triageRetry = (offer: boolean): TrailRetry | null =>
    offer
      ? decision.kind === 'retry'
        ? { kind: 'triage', allowed: true, reason: null }
        : { kind: 'triage', allowed: false, reason: decision.reason }
      : null
  const stages: TrailStage[] = []
  const base = (id: TrailStageId): Pick<TrailStage, 'id' | 'label'> => ({ id, label: TRAIL_STAGES.find((s) => s.id === id)!.label })
  const empty = { startedAt: null, endedAt: null, durationMs: null, problem: null, detail: null, attempts: null, retry: null, skipped: false, note: null }
  // Triaged by the pipeline or a person: never stuck in triage (TRIAGED_STATUSES).
  const triagedStatus = TRIAGED_STATUSES.has(statusOf(report))

  // Reported
  stages.push({ ...base('received'), ...empty, state: 'passed', startedAt: report.created_at, endedAt: report.created_at })

  // Quick check (fast-filter, the stage-1 job)
  {
    const attempts = job ? { used: job.attempts ?? 0, max: job.max_attempts ?? 3 } : null
    const startedAt = job ? (job.started_at ?? job.created_at) : report.created_at
    if (quick) {
      const dur = report.stage1_latency_ms ?? span(startedAt, job?.completed_at ?? null, nowMs)
      stages.push({ ...base('triage'), ...empty, state: 'passed', startedAt, endedAt: job?.completed_at ?? null, durationMs: dur, attempts })
    } else if (deep || triagedStatus) {
      // A stage-2 diagnosis with no stage-1 object, or a report a person sorted: triage is done.
      stages.push({ ...base('triage'), ...empty, state: deep ? 'passed' : 'idle', skipped: !deep, note: deep ? null : 'Sorted without an AI quick check.', attempts })
    } else if (job && isFailedJob(job.status)) {
      const raw = job.last_error ?? report.processing_error
      stages.push({
        ...base('triage'),
        ...empty,
        state: 'failed',
        startedAt,
        endedAt: job.completed_at,
        durationMs: span(startedAt, job.completed_at, nowMs),
        problem: plainTriageError(raw) ?? 'Triage failed.',
        detail: screenDetail(raw),
        attempts,
        retry: triageRetry(true),
      })
    } else if (job && isActiveJob(job.status)) {
      const since = jobSince(job)
      const stuck = (ms(since) ?? nowMs) <= nowMs - STUCK_AFTER_MS
      const started = job.status !== 'pending'
      stages.push({
        ...base('triage'),
        ...empty,
        state: stuck ? 'slow' : started ? 'running' : 'waiting',
        startedAt: since,
        durationMs: span(since, null, nowMs),
        problem: stuck ? (started ? 'The quick check has been running for over 15 minutes.' : 'The quick check has waited for the worker for over 15 minutes.') : null,
        attempts,
        retry: triageRetry(stuck),
      })
    } else if (report.processing_error) {
      // Untriaged with an error stamped on the report (fast-filter's own catch, a schema
      // mismatch, …): the job may still read "completed", since fast-filter answered.
      stages.push({
        ...base('triage'),
        ...empty,
        state: 'failed',
        startedAt,
        endedAt: job?.completed_at ?? null,
        problem: plainTriageError(report.processing_error),
        detail: screenDetail(report.processing_error),
        attempts,
        retry: triageRetry(true),
      })
    } else if (!job && statusOf(report) === 'queued') {
      stages.push({
        ...base('triage'),
        ...empty,
        state: 'waiting',
        startedAt: report.created_at,
        durationMs: span(report.created_at, null, nowMs),
        problem: 'Held back: triage was paused while too many reports were failing (circuit breaker).',
        retry: triageRetry(true),
      })
    } else {
      // No job and nothing stored: stranded before triage (or a completed job whose run stored nothing).
      const old = nowMs - (ms(report.created_at) ?? nowMs) >= STUCK_AFTER_MS
      stages.push({
        ...base('triage'),
        ...empty,
        state: old ? 'slow' : 'waiting',
        startedAt: report.created_at,
        durationMs: span(report.created_at, null, nowMs),
        problem: old ? 'Triage never started for this report.' : null,
        attempts,
        retry: triageRetry(old),
      })
    }
  }

  // Diagnosis (classify-report, stage 2). Optional: fast-filter stops at stage 1 when it is
  // confident (or fell back to its rule) and sets `classified` itself; only a low-confidence
  // report, or an app's first real one, goes on (fast-filter/index.ts).
  {
    const quickStage = stages[stages.length - 1]!
    const startedAt = quickStage.state === 'passed' ? (quickStage.endedAt ?? null) : null
    const status = statusOf(report)
    if (deep) {
      stages.push({ ...base('diagnosis'), ...empty, state: 'passed', startedAt, durationMs: report.stage2_latency_ms ?? null })
    } else if (status === 'quota_exceeded') {
      stages.push({
        ...base('diagnosis'),
        ...empty,
        state: 'failed',
        startedAt,
        problem: "This plan's diagnosis quota is used up, so the full diagnosis did not run. Raise it on Billing.",
        retry: triageRetry(true),
      })
    } else if (triagedStatus) {
      stages.push({ ...base('diagnosis'), ...empty, state: 'idle', skipped: true, note: quick ? 'Not needed: the quick check was sure enough.' : null })
    } else if (!quick) {
      stages.push({ ...base('diagnosis'), ...empty, state: 'idle' })
    } else if (report.processing_error) {
      // Stage 1 stored, not classified, an error stamped: the hand-off or classify-report failed.
      const plain = plainTriageError(report.processing_error) ?? 'Triage failed.'
      stages.push({
        ...base('diagnosis'),
        ...empty,
        state: 'failed',
        startedAt,
        problem: /stage2 handoff/i.test(report.processing_error) ? plain : `The full diagnosis failed: ${lowerFirst(plain)}`,
        detail: screenDetail(report.processing_error),
        retry: triageRetry(true),
      })
    } else {
      const from = ms(startedAt) ?? ms(report.created_at) ?? nowMs
      const stuck = nowMs - from >= DIAGNOSIS_STUCK_MS
      stages.push({
        ...base('diagnosis'),
        ...empty,
        state: stuck ? 'slow' : 'running',
        startedAt,
        durationMs: startedAt ? span(startedAt, null, nowMs) : null,
        problem: stuck ? 'The full diagnosis never came back; the quick-check result is used for now.' : null,
        retry: triageRetry(stuck),
      })
    }
  }

  // Fix (the latest fix attempt)
  const fixStarted = fix ? (fix.started_at ?? fix.created_at) : null
  const fixStatus = (fix?.status ?? '').toLowerCase()
  const prOpen = Boolean(fix?.pr_url)
  if (!fix) {
    stages.push({ ...base('fix'), ...empty, state: 'idle' })
  } else if (prOpen || fixStatus === 'completed' || fixStatus === 'succeeded') {
    stages.push({ ...base('fix'), ...empty, state: 'passed', startedAt: fixStarted, endedAt: fix.completed_at, durationMs: span(fixStarted, fix.completed_at, nowMs) })
  } else if (FIX_FAILED.has(fixStatus)) {
    const human = humanizeFixError(fix.error, { agent: fix.agent, category: fix.failure_category ?? null })
    stages.push({
      ...base('fix'),
      ...empty,
      state: fixStatus === 'cancelled' ? 'cancelled' : 'failed',
      startedAt: fixStarted,
      endedAt: fix.completed_at,
      durationMs: span(fixStarted, fix.completed_at, nowMs),
      problem: human?.title ?? (fixStatus === 'cancelled' ? 'The fix run was cancelled.' : 'The fix agent stopped without a PR.'),
      detail: screenDetail(fix.error),
      // A "hard" error (already fixed, nothing to tie to code, a setting) reaches the same answer
      // on a retry, so Retry is offered disabled with what to do instead (humanize-error.ts).
      retry: human?.severity === 'hard' ? { kind: 'dispatch', allowed: false, reason: human.hint } : { kind: 'dispatch', allowed: true, reason: null },
    })
  } else {
    stages.push({
      ...base('fix'),
      ...empty,
      state: FIX_ACTIVE.has(fixStatus) || !fixStatus ? 'running' : 'waiting',
      startedAt: fixStarted,
      durationMs: span(fixStarted, null, nowMs),
    })
  }

  // PR
  const prAt = fix?.completed_at ?? null
  const merged = Boolean(fix?.merged_at) || fix?.pr_state === 'merged'
  if (!prOpen) {
    stages.push({ ...base('pr'), ...empty, state: 'idle' })
  } else if (fix?.pr_state === 'closed' && !merged) {
    stages.push({ ...base('pr'), ...empty, state: 'cancelled', startedAt: prAt, problem: 'The pull request was closed without merging.' })
  } else {
    stages.push({ ...base('pr'), ...empty, state: 'passed', startedAt: prAt, endedAt: prAt })
  }

  // CI
  const conclusion = (fix?.check_run_conclusion ?? '').toLowerCase()
  const ciStatus = (fix?.check_run_status ?? '').toLowerCase()
  if (!prOpen || (fix?.pr_state === 'closed' && !merged)) {
    stages.push({ ...base('ci'), ...empty, state: 'idle' })
  } else if (conclusion === 'success' || (merged && !CI_RED.has(conclusion))) {
    stages.push({ ...base('ci'), ...empty, state: 'passed', startedAt: prAt, endedAt: fix?.check_run_updated_at ?? null, durationMs: span(prAt, fix?.check_run_updated_at ?? null, nowMs) })
  } else if (CI_RED.has(conclusion)) {
    stages.push({
      ...base('ci'),
      ...empty,
      state: 'failed',
      startedAt: prAt,
      endedAt: fix?.check_run_updated_at ?? null,
      durationMs: span(prAt, fix?.check_run_updated_at ?? null, nowMs),
      problem: conclusion === 'timed_out' ? 'CI ran out of time on the fix PR.' : "The fix PR's CI checks failed.",
      retry: { kind: 'ci_repair', allowed: true, reason: null },
    })
  } else if (CI_ACTIVE.has(ciStatus) || !conclusion) {
    stages.push({ ...base('ci'), ...empty, state: CI_ACTIVE.has(ciStatus) ? 'running' : 'waiting', startedAt: prAt, durationMs: span(prAt, null, nowMs) })
  } else {
    // neutral / skipped / cancelled: not green, not red (skipped is not green; pipeline-view.ts).
    stages.push({ ...base('ci'), ...empty, state: 'waiting', startedAt: prAt, problem: `CI ended as "${conclusion.replace(/_/g, ' ')}", which is neither a pass nor a fail.` })
  }

  // Merged
  const ciStage = stages[stages.length - 1]!
  if (merged) {
    const mergeStart = fix?.check_run_updated_at ?? prAt
    stages.push({ ...base('merge'), ...empty, state: 'passed', startedAt: mergeStart, endedAt: fix?.merged_at ?? null, durationMs: span(mergeStart, fix?.merged_at ?? null, nowMs) })
  } else if (ciStage.state === 'passed') {
    const since = fix?.check_run_updated_at ?? prAt
    stages.push({ ...base('merge'), ...empty, state: 'waiting', startedAt: since, durationMs: span(since, null, nowMs) })
  } else {
    stages.push({ ...base('merge'), ...empty, state: 'idle' })
  }

  // Live (the first healthy deploy seen after the merge)
  if (merged && fix?.merged_at) {
    const after = input.deploys
      .filter((d) => d.ok !== false && (ms(d.observed_at) ?? 0) >= (ms(fix.merged_at) ?? 0))
      .sort((a, b) => a.observed_at.localeCompare(b.observed_at))[0]
    if (after) {
      stages.push({ ...base('deploy'), ...empty, state: 'passed', startedAt: fix.merged_at, endedAt: after.observed_at, durationMs: span(fix.merged_at, after.observed_at, nowMs) })
    } else if (input.deploys.length > 0 && nowMs - (ms(fix.merged_at) ?? nowMs) > DEPLOY_SLOW_MS) {
      stages.push({ ...base('deploy'), ...empty, state: 'slow', startedAt: fix.merged_at, durationMs: span(fix.merged_at, null, nowMs), problem: 'Merged over a day ago and no deploy has been seen since.' })
    } else {
      // An app that records no deploys can't say when the fix went live: idle, not waiting.
      stages.push({ ...base('deploy'), ...empty, state: input.deploys.length > 0 ? 'waiting' : 'idle', startedAt: fix.merged_at })
    }
  } else {
    stages.push({ ...base('deploy'), ...empty, state: 'idle' })
  }

  const current = stages.find((s) => s.state !== 'passed' && !s.skipped)?.id ?? null
  const failing = stages.find((s) => s.state === 'failed')?.id ?? null
  const jobs: TrailJob[] = [...input.queue]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((q) => ({
      id: q.id,
      stage: q.stage,
      status: q.status,
      attempts: q.attempts ?? 0,
      maxAttempts: q.max_attempts ?? 3,
      lastError: screenDetail(q.last_error),
      createdAt: q.created_at,
      startedAt: q.started_at,
      completedAt: q.completed_at,
    }))
  return { stages, current, failing, jobs }
}

/** A queue job's state in the timeline's words ("Quick check failed · attempt 2 of 3"). */
export function queueJobTimelineTitle(job: Pick<TrailQueueRow, 'stage' | 'status' | 'attempts' | 'max_attempts'>): string {
  const name = job.stage === 'stage1' ? 'Quick check' : `Triage job (${job.stage})`
  const word: Record<string, string> = {
    pending: 'waiting for the worker',
    processing: 'running',
    running: 'running',
    completed: 'done',
    failed: 'failed',
    dead_letter: 'gave up',
  }
  const tries = (job.attempts ?? 0) > 0 ? ` · attempt ${job.attempts} of ${job.max_attempts ?? 3}` : ''
  return `${name} ${word[job.status] ?? job.status}${tries}`
}
