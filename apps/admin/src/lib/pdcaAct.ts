/**
 * FILE: apps/admin/src/lib/pdcaAct.ts
 * PURPOSE: One answer to "why can't this fix ship yet?" for every Act-stage
 *          surface (PdcaReceipt on /fixes, ReportPdcaStory on report detail).
 *
 * REGRESSION (2026-10-02, report 469f6962): PR 424 had red CI, the agent
 * had set review_passed=false, and the PR was then closed unmerged, yet all
 * three surfaces still said "In flight — Awaiting merge". Each derived Act
 * from `pr_url` alone.
 */

import type { StageStamp } from './pdcaStamp'

export type ActBlocker = 'pr_closed' | 'ci_failed' | 'needs_review'

export interface ActFixSignals {
  pr_url?: string | null
  pr_state?: string | null
  merged_at?: string | null
  status?: string | null
  check_run_conclusion?: string | null
  review_passed?: boolean | null
}

const CI_HARD_FAIL = new Set(['failure', 'timed_out', 'cancelled', 'action_required'])

/** Most severe first: a closed PR outranks red CI, which outranks a review flag. */
export function actBlocker(fix: ActFixSignals | null | undefined): ActBlocker | null {
  if (!fix?.pr_url) return null
  if (fix.merged_at || fix.pr_state === 'merged' || fix.status === 'merged') return null
  if (fix.pr_state === 'closed') return 'pr_closed'
  if (CI_HARD_FAIL.has((fix.check_run_conclusion ?? '').toLowerCase())) return 'ci_failed'
  if (fix.review_passed === false) return 'needs_review'
  return null
}

export const ACT_BLOCKER_STAMP: Record<ActBlocker, StageStamp> = {
  pr_closed: 'failed',
  ci_failed: 'blocked',
  needs_review: 'blocked',
}

export const ACT_BLOCKER_COPY: Record<ActBlocker, string> = {
  pr_closed: 'PR closed without merge — dispatch a new fix or close the report',
  ci_failed: 'Blocked: CI failed — fix the checks before merging',
  needs_review: 'Needs review — the agent flagged this fix; read the PR before merging',
}

/** Link label for the PR while a blocker stands (no "Review & merge" on a closed PR). */
export const ACT_BLOCKER_LINK_LABEL: Record<ActBlocker, string> = {
  pr_closed: 'View closed PR',
  ci_failed: 'View failing checks',
  needs_review: 'Review PR',
}

/**
 * The /fixes "Failed / skipped" bucket. Mirrors `isFixCountedFailed` in
 * packages/server/supabase/functions/_shared/fix-loop-status.ts, which feeds
 * the status banner's `failed` count, so the filter, the header and the
 * card's Check stamp agree.
 */
export function isFixCountedFailed(fix: ActFixSignals): boolean {
  const status = (fix.status ?? '').toLowerCase()
  if (status === 'failed' || status.startsWith('skipped')) return true
  const blocker = actBlocker(fix)
  return blocker === 'pr_closed' || blocker === 'ci_failed'
}

/** Breakdown key for a counted failure. Mirrors `fixFailureBucket` on the server. */
export function fixFailureBucket(fix: ActFixSignals & { failure_category?: string | null }): string {
  if (fix.failure_category) return fix.failure_category
  if (fix.pr_state === 'closed') return 'pr_closed_unmerged'
  if (fix.pr_url && fix.status === 'completed') return 'ci_failed'
  return 'unknown'
}
