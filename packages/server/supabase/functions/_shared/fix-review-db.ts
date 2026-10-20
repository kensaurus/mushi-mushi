/**
 * FILE: packages/server/supabase/functions/_shared/fix-review-db.ts
 * PURPOSE: `fix_reviews` reads and writes shared by the cloud-agent
 *          completion path (enqueue), the `agent-pr-review` worker, the merge
 *          routes, the GitHub webhook and the fix timeline (ADR 0030). One row
 *          per fix attempt.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  FIX_REVIEW_PUBLIC_COLUMNS,
  mergeGate,
  overrideRefusal,
  toPublicReview,
  type FixReviewRow,
  type PublicFixReview,
} from './fix-review.ts'

export interface EnqueueReviewTarget {
  fixAttemptId: string
  projectId: string
  reportId: string | null
  prUrl: string | null
}

/**
 * Queue a review for one attempt. Without `force` an attempt that already
 * has a review row keeps it (a webhook and a poll tick racing to the same PR
 * queue one review). With `force` the row goes back to `queued` but KEEPS
 * its last completed verdict, head SHA and findings: the merge gate reads
 * them until the new review completes, so a re-run cannot clear a hold.
 * `run_id` is cleared, so a run still in flight can no longer write.
 * `delayMs` pushes the run back (a burst of pushes reviews once).
 * Never throws: a failed enqueue must not fail the PR bookkeeping around it.
 */
export async function enqueueFixReview(
  db: SupabaseClient,
  target: EnqueueReviewTarget,
  opts: { force?: boolean; now?: Date; delayMs?: number } = {},
): Promise<{ queued: boolean; error?: string }> {
  const nowDate = opts.now ?? new Date()
  const now = nowDate.toISOString()
  const due = new Date(nowDate.getTime() + Math.max(0, opts.delayMs ?? 0)).toISOString()
  const row = {
    fix_attempt_id: target.fixAttemptId,
    project_id: target.projectId,
    report_id: target.reportId,
    pr_url: target.prUrl,
    status: 'queued',
    queued_at: due,
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
        run_id: null,
        skip_reason: null,
        error: null,
        started_at: null,
        updated_at: now,
      },
      { onConflict: 'fix_attempt_id' },
    )
    return error ? { queued: false, error: error.message } : { queued: true }
  } catch (err) {
    return { queued: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Codes PostgREST returns while `fix_reviews` does not exist yet (before the migration). */
const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205'])

export interface ReviewRowRead {
  row: FixReviewRow | null
  /** A read error other than "the table does not exist yet". */
  error: string | null
  /** The table does not exist yet: callers treat the PR as not reviewed. */
  tableMissing: boolean
}

/** The raw row (for the merge gate, which needs status, verdict and head SHA). */
export async function loadFixReviewRow(db: SupabaseClient, fixAttemptId: string): Promise<ReviewRowRead> {
  const { data, error } = await db
    .from('fix_reviews')
    .select(FIX_REVIEW_PUBLIC_COLUMNS)
    .eq('fix_attempt_id', fixAttemptId)
    .maybeSingle()
  if (error) {
    const missing = TABLE_MISSING_CODES.has(String((error as { code?: string }).code ?? ''))
    return { row: null, error: missing ? null : error.message, tableMissing: missing }
  }
  return { row: (data as FixReviewRow | null) ?? null, error: null, tableMissing: false }
}

/**
 * The attempt's review as callers show it. `currentHead` (the PR head as
 * Mushi last saw it) marks a verdict about an older commit as stale. A failed
 * read shows "not reviewed": this is display only; the merge gate fails closed.
 */
export async function loadFixReview(db: SupabaseClient, fixAttemptId: string, currentHead?: string | null): Promise<PublicFixReview> {
  const { row } = await loadFixReviewRow(db, fixAttemptId)
  return toPublicReview(row, currentHead)
}

/** Reviews whose new run waits this long after a push, so a burst of pushes is reviewed once. */
export const PUSH_REVIEW_DELAY_MS = 5 * 60_000

/**
 * A reviewed PR got new commits (`pull_request.synchronize`): queue a review
 * of the new head, keeping the old verdict until it completes. Only PRs that
 * already have a review row (cloud-agent PRs, or one someone asked to review)
 * are re-queued; a row already queued picks the new head up when it runs.
 */
export async function requeueReviewForNewHead(
  db: SupabaseClient,
  target: EnqueueReviewTarget,
  headSha: string | null | undefined,
  now: Date = new Date(),
): Promise<'requeued' | 'no_review' | 'same_head' | 'already_queued' | 'error'> {
  const { row, error } = await loadFixReviewRow(db, target.fixAttemptId)
  if (error) return 'error'
  if (!row) return 'no_review'
  if (headSha && row.head_sha === headSha && row.status !== 'running') return 'same_head'
  if (row.status === 'queued') return 'already_queued'
  const res = await enqueueFixReview(db, target, { force: true, now, delayMs: PUSH_REVIEW_DELAY_MS })
  return res.queued ? 'requeued' : 'error'
}

const PR_URL_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i

function samePr(prUrl: string | null, repo: string, number: number): boolean {
  const m = prUrl ? PR_URL_RE.exec(prUrl) : null
  return Boolean(m && `${m[1]}/${m[2]}`.toLowerCase() === repo.toLowerCase() && Number(m[3]) === number)
}

/**
 * The fix attempt behind a PR of this project, if Mushi opened (or attached)
 * it. Matched by number, then by the repo in its URL, case-insensitively.
 */
export async function findFixAttemptForPr(
  db: SupabaseClient,
  projectId: string,
  repo: string,
  number: number,
): Promise<{ attempt: { id: string; pr_url: string | null } | null; error: string | null }> {
  const { data, error } = await db
    .from('fix_attempts')
    .select('id, pr_url, created_at')
    .eq('project_id', projectId)
    .eq('pr_number', number)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return { attempt: null, error: error.message }
  const rows = (data ?? []) as Array<{ id: string; pr_url: string | null }>
  return { attempt: rows.find((r) => samePr(r.pr_url, repo, number)) ?? null, error: null }
}

/** Review state per open PR (`owner/repo#n`), for the console's PR list. Empty on a failed read. */
export async function reviewStatesForPrs(
  db: SupabaseClient,
  projectId: string,
  prs: Array<{ repo: string; number: number; headSha: string | null }>,
): Promise<Map<string, PublicFixReview>> {
  const out = new Map<string, PublicFixReview>()
  if (prs.length === 0) return out
  const { data: attempts, error } = await db
    .from('fix_attempts')
    .select('id, pr_url, pr_number')
    .eq('project_id', projectId)
    .in('pr_number', [...new Set(prs.map((p) => p.number))])
  if (error || !attempts?.length) return out
  const byAttempt = new Map<string, { repo: string; number: number; headSha: string | null }>()
  for (const pr of prs) {
    const hit = (attempts as Array<{ id: string; pr_url: string | null }>).find((a) => samePr(a.pr_url, pr.repo, pr.number))
    if (hit) byAttempt.set(hit.id, pr)
  }
  if (byAttempt.size === 0) return out
  const { data: reviews, error: reviewErr } = await db
    .from('fix_reviews')
    .select(FIX_REVIEW_PUBLIC_COLUMNS)
    .in('fix_attempt_id', [...byAttempt.keys()])
  if (reviewErr) return out
  for (const row of (reviews ?? []) as FixReviewRow[]) {
    const pr = byAttempt.get(row.fix_attempt_id)
    if (pr) out.set(`${pr.repo}#${pr.number}`, toPublicReview(row, pr.headSha))
  }
  return out
}

export type GateEvaluation =
  | {
      ok: true
      review: PublicFixReview
      /** True when a hold was overridden by this request. */
      overridden: boolean
      /** Pass to GitHub's merge as `sha`: a head that moved after this check makes GitHub refuse. */
      expectedHeadSha: string | null
    }
  | { ok: false; status: 400 | 403 | 409 | 503; code: string; message: string; review: PublicFixReview | null }

/**
 * The review gate for one merge (ADR 0030), shared by
 * POST /v1/admin/fixes/:id/merge and the console's generic PR merge:
 *   - a review read that fails for any reason other than the table not
 *     existing yet is a 503: never merge on an unknown verdict;
 *   - a hold (current or stale) is a 409 unless the caller overrides, and an
 *     override needs a console session, a non-viewer and a reason;
 *   - everything else passes and returns the head SHA the merge must land.
 */
export async function evaluateMergeGate(
  db: SupabaseClient,
  input: {
    fixAttemptId: string
    currentHead: string | null
    override: boolean
    overrideReason: string | null
    authMethod: string | null | undefined
    role: string | null | undefined
  },
): Promise<GateEvaluation> {
  const read = await loadFixReviewRow(db, input.fixAttemptId)
  if (read.error) {
    return {
      ok: false,
      status: 503,
      code: 'REVIEW_UNAVAILABLE',
      message: 'Mushi could not read the Opus review of this pull request, so it will not merge it now. Try again in a minute.',
      review: null,
    }
  }
  const review = toPublicReview(read.row, input.currentHead)
  const plain = mergeGate(read.row, { currentHead: input.currentHead })
  if (plain.allowed) return { ok: true, review, overridden: false, expectedHeadSha: plain.expectedHeadSha }
  if (!input.override) return { ok: false, status: 409, code: plain.code, message: plain.message, review }
  const refusal = overrideRefusal({ authMethod: input.authMethod, role: input.role, reason: input.overrideReason })
  if (refusal) return { ok: false, ...refusal, review }
  const overridden = mergeGate(read.row, { currentHead: input.currentHead, override: true })
  if (!overridden.allowed) return { ok: false, status: 409, code: overridden.code, message: overridden.message, review }
  return { ok: true, review, overridden: true, expectedHeadSha: overridden.expectedHeadSha }
}
