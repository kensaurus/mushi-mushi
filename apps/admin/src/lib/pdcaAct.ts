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

export type ActBlocker = 'pr_closed' | 'ci_failed' | 'ci_infra' | 'needs_review'

export interface ActFixSignals {
  pr_url?: string | null
  pr_state?: string | null
  merged_at?: string | null
  status?: string | null
  check_run_conclusion?: string | null
  review_passed?: boolean | null
  /** Why the agent flagged its own fix; empty when nobody flagged it. */
  review_reasoning?: string | null
  error?: string | null
  /** ADR 0033: set when the test machine, not the code, stopped CI. */
  ci_infra?: { infra: boolean; kind?: string } | null
}

const CI_HARD_FAIL = new Set(['failure', 'timed_out', 'cancelled', 'action_required'])

/**
 * Whether the agent itself flagged this fix for a person. `review_passed`
 * defaults to false in the database and local or cloud fixes never set it,
 * so false alone meant nothing: every fix read "flagged", including ones
 * Opus said to merge (report 9831ade8). A flag is false WITH the agent's
 * reason, or the fix worker's own `review_failed` stop.
 */
export function agentFlaggedFix(fix: Pick<ActFixSignals, 'review_passed' | 'review_reasoning' | 'error'> | null | undefined): boolean {
  if (fix?.review_passed !== false) return false
  return !!fix.review_reasoning?.trim() || /^review_failed\b/i.test(fix.error ?? '')
}

/** Most severe first: a closed PR outranks red CI, which outranks a review flag. */
export function actBlocker(fix: ActFixSignals | null | undefined): ActBlocker | null {
  if (!fix?.pr_url) return null
  if (fix.merged_at || fix.pr_state === 'merged' || fix.status === 'merged') return null
  if (fix.pr_state === 'closed') return 'pr_closed'
  // The machine stopped or never came: the fix is untested, not failing.
  if (fix.ci_infra?.infra) return 'ci_infra'
  if (CI_HARD_FAIL.has((fix.check_run_conclusion ?? '').toLowerCase())) return 'ci_failed'
  if (agentFlaggedFix(fix)) return 'needs_review'
  return null
}

export const ACT_BLOCKER_STAMP: Record<ActBlocker, StageStamp> = {
  pr_closed: 'failed',
  ci_failed: 'blocked',
  ci_infra: 'blocked',
  needs_review: 'blocked',
}

export const ACT_BLOCKER_COPY: Record<ActBlocker, string> = {
  pr_closed: 'PR closed without merge — dispatch a new fix or close the report',
  ci_failed: 'Blocked: CI failed — fix the checks before merging',
  ci_infra: 'Not tested: the test machine stopped — re-run the tests before merging',
  needs_review: 'Needs review — the agent flagged this fix; read the PR before merging',
}

/** Link label for the PR while a blocker stands (no "Review & merge" on a closed PR). */
export const ACT_BLOCKER_LINK_LABEL: Record<ActBlocker, string> = {
  pr_closed: 'View closed PR',
  ci_failed: 'View failing checks',
  ci_infra: 'View checks',
  needs_review: 'Review PR',
}

/** Breakdown key for a counted failure. Mirrors `fixFailureBucket` on the server. */
export function fixFailureBucket(fix: ActFixSignals & { failure_category?: string | null }): string {
  if (fix.failure_category) return fix.failure_category
  if (fix.pr_state === 'closed') return 'pr_closed_unmerged'
  if (fix.pr_url && fix.ci_infra?.infra) return 'ci_infra'
  if (fix.pr_url && fix.status === 'completed') return 'ci_failed'
  return 'unknown'
}
