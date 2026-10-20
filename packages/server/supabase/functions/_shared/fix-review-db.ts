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

export interface PrReviews {
  /** Every review linked to the PR: through a fix attempt OR through fix_reviews.pr_url. */
  rows: FixReviewRow[]
  /** Fix attempts whose pr_url points at the PR (plus the one the caller named). */
  attemptIds: string[]
  /** A read failed (other than the table not existing yet): callers fail closed. */
  error: string | null
}

/**
 * Every review linked to one PR of a project. Two independent links, so a
 * caller cannot unlink a held fix by rewriting `fix_attempts.pr_url`:
 *   - fix attempts whose pr_url names this PR (and `fixAttemptId`, when the
 *     caller merges a known attempt);
 *   - fix_reviews rows whose pr_url names this PR. That column is written only
 *     by the service role (the enqueue and the worker), never by an API.
 */
export async function loadReviewsForPr(
  db: SupabaseClient,
  input: { projectId: string; repo: string; number: number; fixAttemptId?: string | null },
): Promise<PrReviews> {
  const { data: attempts, error: attemptErr } = await db
    .from('fix_attempts')
    .select('id, pr_url')
    .eq('project_id', input.projectId)
    .eq('pr_number', input.number)
    .limit(50)
  if (attemptErr) return { rows: [], attemptIds: [], error: attemptErr.message }
  const attemptIds = new Set(
    ((attempts ?? []) as Array<{ id: string; pr_url: string | null }>)
      .filter((a) => samePr(a.pr_url, input.repo, input.number))
      .map((a) => a.id),
  )
  if (input.fixAttemptId) attemptIds.add(input.fixAttemptId)

  const rows = new Map<string, FixReviewRow>()
  const missing = (err: { code?: string } | null) => TABLE_MISSING_CODES.has(String(err?.code ?? ''))
  if (attemptIds.size > 0) {
    const { data, error } = await db.from('fix_reviews').select(FIX_REVIEW_PUBLIC_COLUMNS).in('fix_attempt_id', [...attemptIds])
    if (error && !missing(error as { code?: string })) return { rows: [], attemptIds: [...attemptIds], error: error.message }
    for (const r of (data ?? []) as FixReviewRow[]) rows.set(r.id, r)
  }
  // `%/pull/<n>` narrows by number; the repo is matched exactly below.
  const { data: byUrl, error: urlErr } = await db
    .from('fix_reviews')
    .select(`${FIX_REVIEW_PUBLIC_COLUMNS}, pr_url`)
    .eq('project_id', input.projectId)
    .like('pr_url', `%/pull/${input.number}`)
    .limit(50)
  if (urlErr && !missing(urlErr as { code?: string })) return { rows: [], attemptIds: [...attemptIds], error: urlErr.message }
  for (const r of (byUrl ?? []) as Array<FixReviewRow & { pr_url: string | null }>) {
    if (samePr(r.pr_url, input.repo, input.number)) rows.set(r.id, r)
  }
  return { rows: [...rows.values()], attemptIds: [...attemptIds], error: null }
}

/** Review state per open PR (`owner/repo#n`), for the console's PR list. Empty on a failed read. */
export async function reviewStatesForPrs(
  db: SupabaseClient,
  projectId: string,
  prs: Array<{ repo: string; number: number; headSha: string | null }>,
): Promise<Map<string, PublicFixReview>> {
  const out = new Map<string, PublicFixReview>()
  for (const pr of prs) {
    const found = await loadReviewsForPr(db, { projectId, repo: pr.repo, number: pr.number })
    if (found.error || found.rows.length === 0) continue
    out.set(`${pr.repo}#${pr.number}`, toPublicReview(pickDisplayRow(found.rows, null), pr.headSha))
  }
  return out
}

/** The review to show: a hold first (it is what blocks), else the newest verdict, else any. */
function pickDisplayRow(rows: FixReviewRow[], preferAttemptId: string | null): FixReviewRow {
  return (
    rows.find((r) => r.verdict === 'hold') ??
    rows.find((r) => r.fix_attempt_id === preferAttemptId) ??
    [...rows].sort((a, b) => String(b.reviewed_at ?? '').localeCompare(String(a.reviewed_at ?? '')))[0]
  )
}

export type GateEvaluation =
  | {
      ok: true
      review: PublicFixReview
      /** True when a hold was overridden by this request. */
      overridden: boolean
      /** True when a console user merged while the first review was still running. */
      mergedBeforeReview: boolean
      /** Pass to GitHub's merge as `sha` when a review is linked: a head that moved after this check makes GitHub refuse. */
      expectedHeadSha: string | null
      /** Fix attempts and reviews linked to the PR (for the audit log). */
      attemptIds: string[]
      reviewIds: string[]
    }
  | { ok: false; status: 400 | 403 | 409 | 503; code: string; message: string; review: PublicFixReview | null }

export interface GateCaller {
  override: boolean
  overrideReason: string | null
  /** A console user saw "review in progress" and chose to merge anyway. */
  confirmPendingReview: boolean
  authMethod: string | null | undefined
  role: string | null | undefined
}

/**
 * The review gate for one PR (ADR 0030), over EVERY review linked to it:
 *   - a read failure (other than the table not existing yet) is a 503;
 *   - any hold (current or on an older commit) is a 409 unless overridden,
 *     and an override needs a console session, a non-viewer and a reason;
 *   - a cloud-agent fix whose first review is still queued or running is a
 *     409 REVIEW_PENDING for an API key, and for a console user until they
 *     confirm; a review that was skipped (no key, turned off) or failed keeps
 *     today's behaviour, as does a PR with no review at all;
 *   - otherwise the merge goes ahead, pinned to the head the gate saw.
 */
export function decidePrGate(found: PrReviews, currentHead: string | null, caller: GateCaller, preferAttemptId: string | null = null): GateEvaluation {
  if (found.error) {
    return {
      ok: false,
      status: 503,
      code: 'REVIEW_UNAVAILABLE',
      message: 'Mushi could not read the Opus review of this pull request, so it will not merge it now. Try again in a minute.',
      review: null,
    }
  }
  const base = { attemptIds: found.attemptIds, reviewIds: found.rows.map((r) => r.id) }
  if (found.rows.length === 0) {
    return { ok: true, review: toPublicReview(null), overridden: false, mergedBeforeReview: false, expectedHeadSha: null, ...base }
  }
  const shown = pickDisplayRow(found.rows, preferAttemptId)
  const review = toPublicReview(shown, currentHead)
  const hold = found.rows.find((r) => r.verdict === 'hold')
  if (hold) {
    const plain = mergeGate(hold, { currentHead })
    if (plain.allowed) {
      return { ok: true, review, overridden: false, mergedBeforeReview: false, expectedHeadSha: plain.expectedHeadSha, ...base }
    }
    if (!caller.override) return { ok: false, status: 409, code: plain.code, message: plain.message, review }
    const refusal = overrideRefusal({ authMethod: caller.authMethod, role: caller.role, reason: caller.overrideReason })
    if (refusal) return { ok: false, ...refusal, review }
    return { ok: true, review, overridden: true, mergedBeforeReview: false, expectedHeadSha: currentHead ?? hold.head_sha, ...base }
  }
  const pending = found.rows.find((r) => !r.verdict && (r.status === 'queued' || r.status === 'running'))
  if (pending) {
    if (caller.authMethod !== 'jwt') {
      return {
        ok: false,
        status: 409,
        code: 'REVIEW_PENDING',
        message: 'The Opus review of this pull request is still running, so Mushi will not merge it from an API key. Wait a few minutes, or merge it from the Mushi console.',
        review,
      }
    }
    if (!caller.confirmPendingReview) {
      return {
        ok: false,
        status: 409,
        code: 'REVIEW_PENDING',
        message: 'The Opus review of this pull request is still running. Confirm that you want to merge before it finishes.',
        review,
      }
    }
    return { ok: true, review, overridden: false, mergedBeforeReview: true, expectedHeadSha: currentHead, ...base }
  }
  const plain = mergeGate(shown, { currentHead })
  return {
    ok: true,
    review,
    overridden: false,
    mergedBeforeReview: false,
    expectedHeadSha: plain.allowed ? plain.expectedHeadSha : currentHead,
    ...base,
  }
}
