/**
 * FILE: packages/server/supabase/functions/_shared/gated-merge.ts
 * PURPOSE: The one way Mushi merges a pull request a person or a key asked it
 *          to merge (ADR 0030). Every merge route goes through
 *          `gatedMergePullRequest`, so a new merge path cannot forget the
 *          agent PR review gate:
 *            POST /v1/admin/fixes/:id/merge             (console, merge_fix, CLI)
 *            POST /v1/admin/projects/:pid/pull-requests/:owner/:repo/:number/merge
 *            POST /v1/admin/projects/:pid/ux-runs/:runId/merge
 *            POST /v1/admin/projects/:pid/sdk-upgrade/:id/merge
 *
 *          It reads the PR's head, finds every review linked to the PR (by
 *          fix attempt and by the service-role-written fix_reviews.pr_url,
 *          so a rewritten fix_attempts.pr_url cannot unlink a hold), applies
 *          the gate and its override rules, and merges only the head it saw.
 *
 *          No other file calls `mergeGithubPullRequest` (a test scans for
 *          it). Every merge also requires the PR's repo to be one of the
 *          project's repos (403 REPO_NOT_IN_PROJECT).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { mergeGithubPullRequest, type MergeMethod } from './fix-merge.ts'
import { fetchPullRequest, type GithubRepoRef } from './github.ts'
import { connectedRepoRefs, sameRepo } from './github-pr-checks.ts'
import { decidePrGate, loadReviewsForPr, type GateCaller, type GateEvaluation } from './fix-review-db.ts'

export interface GatedMergeInput extends GateCaller {
  projectId: string
  token: string
  ref: GithubRepoRef
  number: number
  /** The fix attempt being merged, when the caller knows it (the fix route). */
  fixAttemptId?: string | null
  /** The PR head the caller already read; fetched from GitHub when omitted. */
  currentHead?: string | null
  merge: { mergeMethod: MergeMethod; commitTitle?: string; commitMessage?: string }
}

type MergeResult = Awaited<ReturnType<typeof mergeGithubPullRequest>>

export type GatedMergeOutcome =
  | { ok: false; status: 400 | 403 | 404 | 409 | 502 | 503; code: string; message: string; review: GateEvaluation['review'] | null }
  | {
      ok: true
      /** GitHub's answer; `merged: false` (conflict, moved head, blocked) is the caller's to report. */
      result: MergeResult
      gate: Extract<GateEvaluation, { ok: true }>
      /** Spread into the caller's audit metadata. */
      audit: Record<string, unknown>
    }

/**
 * Gate, then merge. Throws only what `mergeGithubPullRequest` throws (GitHub
 * errors other than the refusals it maps), so callers keep their 502 path.
 */
export async function gatedMergePullRequest(db: SupabaseClient, input: GatedMergeInput): Promise<GatedMergeOutcome> {
  // C1: a project merges only PRs of its own repos. Without this a fix
  // attempt in project Y pointed at project X's PR could merge X's code
  // with Y's token and Y's (absent) review.
  const own = await connectedRepoRefs(db, input.projectId)
  if (!own.some((r) => sameRepo(r, input.ref))) {
    return {
      ok: false,
      status: 403,
      code: 'REPO_NOT_IN_PROJECT',
      message: `${input.ref.owner}/${input.ref.repo} is not one of this project's repositories, so Mushi will not merge its pull requests from here.`,
      review: null,
    }
  }

  let currentHead = input.currentHead ?? null
  if (input.currentHead === undefined) {
    try {
      const pull = await fetchPullRequest(input.token, input.ref, input.number)
      if (!pull) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'GitHub did not find the pull request', review: null }
      currentHead = pull.headSha ?? null
    } catch (err) {
      return { ok: false, status: 502, code: 'GITHUB_READ_FAILED', message: (err instanceof Error ? err.message : String(err)).slice(0, 200), review: null }
    }
  }

  const found = await loadReviewsForPr(db, {
    projectId: input.projectId,
    repo: `${input.ref.owner}/${input.ref.repo}`,
    number: input.number,
    fixAttemptId: input.fixAttemptId ?? null,
  })
  const gate = decidePrGate(found, currentHead, input, input.fixAttemptId ?? null)
  if (!gate.ok) return gate

  const linked = gate.reviewIds.length > 0
  const result = await mergeGithubPullRequest(input.token, input.ref, input.number, {
    ...input.merge,
    // Pin the commit whenever a review is linked: new commits after the
    // check make GitHub refuse instead of merging code nobody reviewed.
    ...(linked ? { sha: gate.expectedHeadSha ?? currentHead } : {}),
  })

  const audit: Record<string, unknown> = linked || gate.attemptIds.length > 0
    ? {
        fix_attempt_ids: gate.attemptIds,
        review_state: gate.review.state,
        merged_head_sha: linked ? (gate.expectedHeadSha ?? currentHead) : null,
        ...(gate.overridden ? { review_override: true, override_reason: input.overrideReason } : {}),
        ...(gate.mergedBeforeReview ? { merged_before_review: true } : {}),
      }
    : {}
  return { ok: true, result, gate, audit }
}
