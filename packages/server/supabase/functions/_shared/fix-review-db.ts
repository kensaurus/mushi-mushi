/**
 * FILE: packages/server/supabase/functions/_shared/fix-review-db.ts
 * PURPOSE: `fix_reviews` reads and writes shared by the cloud-agent
 *          completion path (enqueue), the `agent-pr-review` worker, the merge
 *          route and the fix timeline (ADR 0030). One row per fix attempt.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { FIX_REVIEW_PUBLIC_COLUMNS, toPublicReview, type FixReviewRow, type PublicFixReview } from './fix-review.ts'

export interface EnqueueReviewTarget {
  fixAttemptId: string
  projectId: string
  reportId: string | null
  prUrl: string | null
}

/**
 * Queue a review for one attempt. Without `force` an attempt that already
 * has a review row keeps it (a webhook and a poll tick racing to the same PR
 * queue one review). With `force` the row goes back to `queued` and the old
 * verdict is cleared, so a stale "hold" cannot gate the new commits.
 * Never throws: a failed enqueue must not fail the PR bookkeeping around it.
 */
export async function enqueueFixReview(
  db: SupabaseClient,
  target: EnqueueReviewTarget,
  opts: { force?: boolean; now?: Date } = {},
): Promise<{ queued: boolean; error?: string }> {
  const now = (opts.now ?? new Date()).toISOString()
  const row = {
    fix_attempt_id: target.fixAttemptId,
    project_id: target.projectId,
    report_id: target.reportId,
    pr_url: target.prUrl,
    status: 'queued',
    queued_at: now,
  }
  try {
    if (!opts.force) {
      const { error } = await db
        .from('fix_reviews')
        .upsert(row, { onConflict: 'fix_attempt_id', ignoreDuplicates: true })
      return error ? { queued: false, error: error.message } : { queued: true }
    }
    const { error } = await db.from('fix_reviews').upsert(
      {
        ...row,
        attempts: 0,
        verdict: null,
        fixes_report: null,
        risk: null,
        findings: [],
        scope_creep: null,
        removes_behavior: [],
        needs_human_decision: null,
        summary: null,
        rules_applied: [],
        skip_reason: null,
        error: null,
        started_at: null,
        completed_at: null,
        updated_at: now,
      },
      { onConflict: 'fix_attempt_id' },
    )
    return error ? { queued: false, error: error.message } : { queued: true }
  } catch (err) {
    return { queued: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** The attempt's review as callers show it; "not reviewed" when there is none or the read fails. */
export async function loadFixReview(db: SupabaseClient, fixAttemptId: string): Promise<PublicFixReview> {
  const { data, error } = await db
    .from('fix_reviews')
    .select(FIX_REVIEW_PUBLIC_COLUMNS)
    .eq('fix_attempt_id', fixAttemptId)
    .maybeSingle()
  if (error) return toPublicReview(null)
  return toPublicReview((data as FixReviewRow | null) ?? null)
}

/** The raw row (for the merge gate, which needs status + verdict). */
export async function loadFixReviewRow(db: SupabaseClient, fixAttemptId: string): Promise<{ row: FixReviewRow | null; error: string | null }> {
  const { data, error } = await db
    .from('fix_reviews')
    .select(FIX_REVIEW_PUBLIC_COLUMNS)
    .eq('fix_attempt_id', fixAttemptId)
    .maybeSingle()
  if (error) return { row: null, error: error.message }
  return { row: (data as FixReviewRow | null) ?? null, error: null }
}
