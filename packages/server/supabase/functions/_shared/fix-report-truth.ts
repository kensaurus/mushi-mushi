/**
 * FILE: packages/server/supabase/functions/_shared/fix-report-truth.ts
 * PURPOSE: One answer to "what is the fix state of this REPORT right now?"
 *          for every fix count in the console (dashboard, /fixes, /inbox,
 *          nav badges, project rows) and for the dispatch guard.
 *
 * REGRESSION (2026-10-04, glot.it): every count was built from fix attempts.
 * Four reports had been fixed by merged PRs #138–#141, but their eight
 * earlier failed attempts and three closed PRs still read "8 auto-fixes
 * failed", "OPEN PRS 7" and "Retry 8 failed". Retry would have re-dispatched
 * bugs that were already fixed. Counts are now grouped by report and taken
 * from the report's current state:
 *
 *   resolved  — report is fixed / verified / resolved / dismissed, or one of
 *               its attempts merged (unless the report was reopened)
 *   in_flight — an attempt is queued / running / pending
 *   pr_open   — an attempt has an open (or draft) PR that is not blocked
 *   failed    — the latest attempt failed, was skipped, or its PR closed
 *               unmerged / went red (isFixCountedFailed)
 *   none      — nothing to act on
 *
 * Only `fix-loop-status.ts` is imported, so the Deno CI test runs without
 * permissions and the vitest suite imports this file directly.
 */

import { fixFailureBucket, isFixCountedFailed } from './fix-loop-status.ts'

export const RESOLVED_REPORT_STATUSES: ReadonlySet<string> = new Set([
  'fixed',
  'verified',
  'resolved',
  'dismissed',
])
const FIXED_REPORT_STATUSES: ReadonlySet<string> = new Set(['fixed', 'verified', 'resolved'])
const LIVE_ATTEMPT_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'pending', 'dispatched'])

export type ReportFixState = 'resolved' | 'in_flight' | 'pr_open' | 'failed' | 'none'

export interface TruthAttempt {
  id: string
  report_id: string
  status?: string | null
  pr_url?: string | null
  pr_number?: number | null
  pr_state?: string | null
  merged_at?: string | null
  check_run_conclusion?: string | null
  failure_category?: string | null
  error?: string | null
  created_at?: string | null
  started_at?: string | null
}

export interface TruthReport {
  id: string
  status?: string | null
}

/** A provider whose key the failed attempt says was rejected. */
export type CredentialProvider = 'openai' | 'anthropic' | 'cursor' | 'github'

export interface CredentialBlock {
  provider: CredentialProvider
  /** true = a working key is on file now; false = known bad; null = not checked yet. */
  keyHealthy: boolean | null
}

export interface ReportFixTruth {
  reportId: string
  state: ReportFixState
  /** Newest attempt for the report (by created_at). */
  latestAttemptId: string | null
  /** PR number of the merged attempt that fixed the report, if any. */
  mergedPrNumber: number | null
  /** The report is fixed (not merely dismissed). */
  fixed: boolean
  /** Retrying makes sense now: the latest attempt failed for a reason a new run can clear. */
  retryable: boolean
  /** Set when the latest attempt failed on a rejected key. */
  credential: CredentialBlock | null
  /** Failure breakdown key for a `failed` report, else null. */
  failureBucket: string | null
}

function ts(a: TruthAttempt): number {
  const t = Date.parse(a.created_at ?? a.started_at ?? '')
  return Number.isFinite(t) ? t : 0
}

export function isAttemptMerged(a: TruthAttempt): boolean {
  return Boolean(a.merged_at) || a.pr_state === 'merged'
}

function isAttemptLive(a: TruthAttempt): boolean {
  return LIVE_ATTEMPT_STATUSES.has((a.status ?? '').toLowerCase())
}

function isAttemptPrOpen(a: TruthAttempt): boolean {
  if (!a.pr_url || isAttemptMerged(a) || isFixCountedFailed(a)) return false
  if (a.pr_state === 'open' || a.pr_state === 'draft') return true
  // PR state not read yet: a completed attempt with a PR is waiting on review.
  return a.pr_state == null && (a.status ?? '').toLowerCase() === 'completed'
}

/**
 * Which provider's key a failure blames, read from the error text first
 * (fix-worker files a 401 embedding failure under `no_relevant_code`), then
 * from the category. Null when the failure is not about a credential.
 */
export function credentialFailureProvider(
  error: string | null | undefined,
  category?: string | null,
): CredentialProvider | null {
  const m = (error ?? '').toLowerCase()
  const authWords =
    /\b401\b|\b403\b|incorrect api key|invalid api key|invalid x-api-key|authentication_error|unauthorized|api key (?:not set|missing|vault lookup failed)|requires an? \w+ api key/
  if (m) {
    if (m.includes('openai') && authWords.test(m)) return 'openai'
    if ((m.includes('anthropic') || m.includes('claude')) && authWords.test(m)) return 'anthropic'
    if (m.includes('cursor') && (authWords.test(m) || m.includes('cursor_api_key_ref not set'))) return 'cursor'
    if (m.includes('github') && /\b401\b|bad credentials/.test(m)) return 'github'
  }
  if (category === 'claude_api_error' && /key/.test(m)) return 'anthropic'
  return null
}

/**
 * Derive one report's fix state from its report row and ALL of its attempts.
 * `healthyKeyProviders` lists the providers with a working key on file now
 * (byok_keys active + test_status ok); a provider absent from
 * `checkedKeyProviders` is "not checked yet", never assumed healthy.
 */
export function deriveReportFixTruth(input: {
  reportId: string
  report: TruthReport | null | undefined
  attempts: TruthAttempt[]
  healthyKeyProviders?: ReadonlySet<string>
  checkedKeyProviders?: ReadonlySet<string>
}): ReportFixTruth {
  const attempts = [...input.attempts].sort((a, b) => ts(b) - ts(a))
  const latest = attempts[0] ?? null
  const status = (input.report?.status ?? '').toLowerCase()
  const reopened = status === 'reopened'
  const merged = reopened ? null : attempts.find(isAttemptMerged) ?? null
  const base = {
    reportId: input.reportId,
    latestAttemptId: latest?.id ?? null,
    mergedPrNumber: merged?.pr_number ?? null,
    fixed: FIXED_REPORT_STATUSES.has(status) || merged != null,
    retryable: false,
    credential: null,
    failureBucket: null,
  }

  if (RESOLVED_REPORT_STATUSES.has(status) || merged) return { ...base, state: 'resolved' }
  if (attempts.some(isAttemptLive)) return { ...base, state: 'in_flight' }
  if (attempts.some(isAttemptPrOpen)) return { ...base, state: 'pr_open' }
  if (!latest || !isFixCountedFailed(latest)) return { ...base, state: 'none' }

  const provider = credentialFailureProvider(latest.error, latest.failure_category)
  let credential: CredentialBlock | null = null
  if (provider) {
    const checked = input.checkedKeyProviders?.has(provider) ?? false
    credential = {
      provider,
      keyHealthy: input.healthyKeyProviders?.has(provider) ? true : checked ? false : null,
    }
  }
  // A rejected key is cleared by a working key, not by retrying the same
  // run. Any other hard failure (status = failed) can be retried; skipped
  // runs, closed PRs and red CI need a person to decide first.
  const latestStatus = (latest.status ?? '').toLowerCase()
  const retryable = credential ? credential.keyHealthy === true : latestStatus === 'failed'

  return {
    ...base,
    state: 'failed',
    retryable,
    credential,
    failureBucket: credential ? `${credential.provider}_key_rejected` : fixFailureBucket(latest),
  }
}

/** Group attempts by report and derive every report's truth. */
export function deriveReportFixTruths(input: {
  attempts: TruthAttempt[]
  reportsById: ReadonlyMap<string, TruthReport>
  healthyKeyProviders?: ReadonlySet<string>
  checkedKeyProviders?: ReadonlySet<string>
}): Map<string, ReportFixTruth> {
  const byReport = new Map<string, TruthAttempt[]>()
  for (const a of input.attempts) {
    const list = byReport.get(a.report_id)
    if (list) list.push(a)
    else byReport.set(a.report_id, [a])
  }
  const out = new Map<string, ReportFixTruth>()
  for (const [reportId, attempts] of byReport) {
    out.set(
      reportId,
      deriveReportFixTruth({
        reportId,
        report: input.reportsById.get(reportId),
        attempts,
        healthyKeyProviders: input.healthyKeyProviders,
        checkedKeyProviders: input.checkedKeyProviders,
      }),
    )
  }
  return out
}

export interface FixTruthSummary {
  /** Reports with at least one attempt. */
  reports: number
  /** Unfixed reports whose latest attempt failed, was skipped, or whose PR closed / went red. */
  failed: number
  /** Subset of `failed` that a retry can clear right now. */
  retryable: number
  /** Unfixed reports with a PR waiting on review or merge. */
  prOpen: number
  /** Unfixed reports with a fix running now. */
  inFlight: number
  /** Reports fixed (merged PR or a fixed status). */
  fixed: number
  /** Failed reports by cause, most common first. */
  failureBreakdown: Array<{ category: string; count: number }>
}

export function summarizeFixTruths(truths: Iterable<ReportFixTruth>): FixTruthSummary {
  const s: FixTruthSummary = {
    reports: 0,
    failed: 0,
    retryable: 0,
    prOpen: 0,
    inFlight: 0,
    fixed: 0,
    failureBreakdown: [],
  }
  const buckets = new Map<string, number>()
  for (const t of truths) {
    s.reports += 1
    if (t.fixed) s.fixed += 1
    if (t.state === 'in_flight') s.inFlight += 1
    else if (t.state === 'pr_open') s.prOpen += 1
    else if (t.state === 'failed') {
      s.failed += 1
      if (t.retryable) s.retryable += 1
      const key = t.failureBucket ?? 'unknown'
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
  }
  s.failureBreakdown = [...buckets.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
  return s
}

export interface DispatchResolvedBlock {
  code: 'ALREADY_FIXED' | 'REPORT_DISMISSED'
  message: string
}

/**
 * Refuse to dispatch a fix for a report that is already fixed or dismissed.
 * Re-dispatching spends LLM budget and opens a second PR for a bug a merged
 * PR already closed. A reopened report may be dispatched again.
 */
export function fixDispatchResolvedBlock(
  report: TruthReport,
  attempts: TruthAttempt[],
): DispatchResolvedBlock | null {
  const status = (report.status ?? '').toLowerCase()
  if (status === 'reopened') return null
  if (status === 'dismissed') {
    return {
      code: 'REPORT_DISMISSED',
      message: 'This report was dismissed — reopen it to dispatch a fix.',
    }
  }
  const merged = [...attempts].sort((a, b) => ts(b) - ts(a)).find(isAttemptMerged)
  if (merged || FIXED_REPORT_STATUSES.has(status)) {
    const by = merged?.pr_number != null ? `by PR #${merged.pr_number}` : ''
    return {
      code: 'ALREADY_FIXED',
      message: `Already fixed${by ? ` ${by}` : ''} — reopen the report to dispatch again.`,
    }
  }
  return null
}
