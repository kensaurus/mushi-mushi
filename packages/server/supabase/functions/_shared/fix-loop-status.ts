/**
 * FILE: packages/server/supabase/functions/_shared/fix-loop-status.ts
 * PURPOSE: Pure rules for closing the fix loop when a PR ends WITHOUT a
 *          merge. Shared by ci-sync (poll), the refresh-ci route (via
 *          ci-sync) and webhooks-github-indexer (pull_request.closed), so
 *          the three paths agree on what "closed unmerged" means and where
 *          the report goes next.
 *
 * No imports and no env reads: the Deno CI test runs without permissions
 * and the vitest suite imports this file directly.
 */

/** GitHub PR lifecycle as stored in `fix_attempts.pr_state` (CHECK-constrained). */
export type PrLifecycle = 'open' | 'closed' | 'merged' | 'draft'

export function prLifecycleFrom(pr: { merged?: boolean | null; state?: string | null; draft?: boolean | null }): PrLifecycle {
  if (pr.merged) return 'merged'
  if (pr.state === 'closed') return 'closed'
  if (pr.draft) return 'draft'
  return 'open'
}

/**
 * Where a report goes when its only fix PR is closed unmerged. fix-worker
 * overwrites the status with 'fixing' and keeps no history, so this is
 * derived: a report the classifier already scored goes back to the triage
 * queue as 'classified' (the canonical form of triaged); anything else is
 * 'new'.
 */
export function preFixReportStatus(report: {
  category?: string | null
  severity?: string | null
  stage1_classification?: unknown
}): 'classified' | 'new' {
  if (report.category || report.severity || report.stage1_classification) return 'classified'
  return 'new'
}

/**
 * Only a report still parked in 'fixing' is reverted. A human who already
 * moved it (fixed, dismissed, reopened…) wins over a stale PR event, and
 * another live attempt keeps it in 'fixing'.
 */
export function shouldRevertReportOnPrClose(input: {
  reportStatus: string | null | undefined
  otherOpenAttempts: number
}): boolean {
  return input.reportStatus === 'fixing' && input.otherOpenAttempts === 0
}

export const PR_CLOSED_UNMERGED_LABEL = 'PR closed without merge'

/** How long a report may sit in 'fixing' with no live attempt before the sweep acts. */
export const FIXING_GRACE_MS = 30 * 60_000
/** A PR whose state Mushi has never read for this long is reported, not trusted. */
export const PR_UNREAD_LIMIT_MS = 24 * 60 * 60_000

export const FIX_STALLED_NO_LIVE_ATTEMPT =
  'fix_stalled: the last fix attempt ended without an open pull request. Re-dispatch when ready.'
export const FIX_STALLED_PR_UNREADABLE =
  'fix_stalled: Mushi could not read the fix pull request for 24 hours. Check the GitHub connection, then refresh CI on the fix.'

export interface FixingAttemptView {
  id: string
  status: string | null
  pr_url: string | null
  pr_state: string | null
  merged_at: string | null
  created_at: string
  completed_at: string | null
}

export type FixingReportVerdict =
  | { action: 'keep'; reason: 'not_fixing' | 'no_attempts' | 'attempt_live' | 'pr_open' | 'grace' | 'already_flagged' }
  | { action: 'finalize_merged'; attemptId: string }
  | { action: 'flag_unreadable'; attemptId: string; processingError: string }
  | { action: 'revert'; processingError: string }

/**
 * What the ci-sync sweep does with a report sitting in 'fixing'. fix-worker
 * only writes 'fixing' once a PR is open, so 'fixing' means "a PR waits for
 * review". The report is stuck when nothing behind it is alive any more:
 *   - an attempt merged but the merge bookkeeping never ran → finalize it;
 *   - an attempt is still queued/running (the SQL reaper and agent-status-poll
 *     own those timeouts) or its PR is open/draft (a human decides) → keep;
 *   - a PR whose state was never read for 24 h → say so, but keep 'fixing'
 *     (the PR may well be open);
 *   - otherwise, after a grace period → back to triage with a visible reason.
 * A report with no attempts at all was set to 'fixing' by a human; leave it.
 */
export function decideFixingReport(input: {
  report: { status: string | null; updated_at: string | null; processing_error: string | null }
  attempts: FixingAttemptView[]
  now: Date
}): FixingReportVerdict {
  const { report, attempts, now } = input
  if (report.status !== 'fixing') return { action: 'keep', reason: 'not_fixing' }
  if (attempts.length === 0) return { action: 'keep', reason: 'no_attempts' }

  const merged = attempts.find((a) => a.merged_at || a.pr_state === 'merged')
  if (merged) return { action: 'finalize_merged', attemptId: merged.id }

  const nowMs = now.getTime()
  let unreadable: FixingAttemptView | null = null
  for (const a of attempts) {
    const status = (a.status ?? '').toLowerCase()
    if (status === 'queued' || status === 'running' || status === 'pending') {
      return { action: 'keep', reason: 'attempt_live' }
    }
    if (!a.pr_url) continue
    if (a.pr_state === 'open' || a.pr_state === 'draft') return { action: 'keep', reason: 'pr_open' }
    if (a.pr_state == null) {
      const since = Date.parse(a.completed_at ?? a.created_at)
      if (!Number.isFinite(since) || nowMs - since < PR_UNREAD_LIMIT_MS) {
        return { action: 'keep', reason: 'attempt_live' }
      }
      unreadable ??= a
    }
  }

  if (unreadable) {
    if (report.processing_error === FIX_STALLED_PR_UNREADABLE) return { action: 'keep', reason: 'already_flagged' }
    return { action: 'flag_unreadable', attemptId: unreadable.id, processingError: FIX_STALLED_PR_UNREADABLE }
  }

  const touched = Date.parse(report.updated_at ?? '')
  if (Number.isFinite(touched) && nowMs - touched < FIXING_GRACE_MS) return { action: 'keep', reason: 'grace' }
  return { action: 'revert', processingError: FIX_STALLED_NO_LIVE_ATTEMPT }
}

const CI_HARD_FAIL = new Set(['failure', 'timed_out', 'cancelled', 'action_required'])

/**
 * One definition of a "failed" fix for every count on /fixes (status banner,
 * tab badge, "Failed / skipped" filter). Before 2026-10-02 the counts only
 * looked at `status === 'failed'`, so an attempt that opened a PR whose CI
 * went red (or that was closed unmerged) showed Check = Failed on its card
 * while every count read 0.
 */
export function isFixCountedFailed(a: {
  status?: string | null
  pr_url?: string | null
  pr_state?: string | null
  merged_at?: string | null
  check_run_conclusion?: string | null
}): boolean {
  const status = (a.status ?? '').toLowerCase()
  if (status === 'failed' || status.startsWith('skipped')) return true
  if (!a.pr_url || a.merged_at || a.pr_state === 'merged') return false
  if (a.pr_state === 'closed') return true
  return CI_HARD_FAIL.has((a.check_run_conclusion ?? '').toLowerCase())
}

/** Breakdown key for a counted failure: the worker's category, else why the PR is blocked. */
export function fixFailureBucket(a: {
  status?: string | null
  pr_url?: string | null
  pr_state?: string | null
  failure_category?: string | null
}): string {
  if (typeof a.failure_category === 'string' && a.failure_category) return a.failure_category
  if (a.pr_state === 'closed') return 'pr_closed_unmerged'
  if (a.pr_url && a.status === 'completed') return 'ci_failed'
  return 'unknown'
}
