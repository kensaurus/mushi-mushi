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
 *          It always reads the PR from GitHub and keys everything on the
 *          repo GitHub names now (`base.repo`), never on the URL's spelling:
 *          a renamed repo still answers under its old name. The PR's repo
 *          must be one of the project's repos (403 REPO_NOT_IN_PROJECT; 409
 *          REPO_RENAMED when only the old name is connected). It finds every
 *          review of the PR (by GitHub repo id or name + number, in any
 *          project, and by this project's fix attempts), applies the gate
 *          and its override rules, and merges only the head it saw.
 *
 *          No other file calls `mergeGithubPullRequest` (a test scans for it).
 *
 *          A service caller (`caller: 'service'`, the fix-verifier worker's
 *          verified merge, ADR 0035) can never override a hold or merge past
 *          a pending review, whatever else it passes; it merges only a PR
 *          whose current Opus verdict on this exact head is "merge", and only
 *          the head it names (`expectedHeadSha`).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { mergeGithubPullRequest, type MergeMethod } from './fix-merge.ts'
import { fetchPullRequest, type GithubRepoRef, type PullRequestSnapshot } from './github.ts'
import { connectedRepoRefs, sameRepo } from './github-pr-checks.ts'
import { decidePrGate, loadReviewsForPr, type GateCaller, type GateEvaluation } from './fix-review-db.ts'
import { recordMergedHead, type MergedHeadTarget } from './fix-verify-db.ts'

export interface GatedMergeInput extends GateCaller {
  projectId: string
  token: string
  ref: GithubRepoRef
  number: number
  /** The fix attempt being merged, when the caller knows it (the fix route). */
  fixAttemptId?: string | null
  /** The PR the caller already read from GitHub (head and base repo); fetched when omitted. */
  pull?: Pick<PullRequestSnapshot, 'headSha' | 'baseRepoId' | 'baseRepoFullName'>
  merge: { mergeMethod: MergeMethod; commitTitle?: string; commitMessage?: string }
  /**
   * 'service': Mushi itself is merging (no person, no key). The override and
   * pending-review fields above are ignored for it.
   */
  caller?: 'service'
  /** Why a service caller merges (audited), e.g. 'verified_auto_merge'. */
  reason?: string
  /** The head the caller checked; any other head is refused (409 HEAD_MOVED) and GitHub merges only this one. */
  expectedHeadSha?: string | null
}

/** What a service caller is held to: no override, no merge past a pending review, never a console session. */
const SERVICE_CALLER: GateCaller = { override: false, overrideReason: null, confirmPendingReview: false, authMethod: 'service', role: null }

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
  let pull = input.pull ?? null
  if (!pull) {
    try {
      pull = await fetchPullRequest(input.token, input.ref, input.number)
      if (!pull) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'GitHub did not find the pull request', review: null }
    } catch (err) {
      return { ok: false, status: 502, code: 'GITHUB_READ_FAILED', message: (err instanceof Error ? err.message : String(err)).slice(0, 200), review: null }
    }
  }
  const currentHead = pull.headSha ?? null
  const service = input.caller === 'service'
  if (service && !input.expectedHeadSha) {
    return { ok: false, status: 400, code: 'HEAD_REQUIRED', message: 'A service merge must name the head commit it checked.', review: null }
  }
  if (input.expectedHeadSha && currentHead !== input.expectedHeadSha) {
    return {
      ok: false,
      status: 409,
      code: 'HEAD_MOVED',
      message: 'The pull request got new commits after it was checked. Nothing was merged; the new commits are checked from the start.',
      review: null,
    }
  }
  const asked = `${input.ref.owner}/${input.ref.repo}`.toLowerCase()
  // The repo as GitHub names it now. GitHub redirects an old name after a
  // rename, so the URL's spelling is not the PR's identity.
  const [owner, repo] = (pull.baseRepoFullName ?? asked).toLowerCase().split('/')
  const ref: GithubRepoRef = { owner, repo }

  // C1: a project merges only PRs of its own repos. Without this a fix
  // attempt in project Y pointed at project X's PR could merge X's code
  // with Y's token and Y's (absent) review.
  const own = await connectedRepoRefs(db, input.projectId)
  if (!own.some((r) => sameRepo(r, ref))) {
    if (own.some((r) => sameRepo(r, input.ref))) {
      return {
        ok: false,
        status: 409,
        code: 'REPO_RENAMED',
        message: `${asked} is now ${owner}/${repo} on GitHub. Update this project's connected repository to ${owner}/${repo}, then merge again.`,
        review: null,
      }
    }
    return {
      ok: false,
      status: 403,
      code: 'REPO_NOT_IN_PROJECT',
      message: `${owner}/${repo} is not one of this project's repositories, so Mushi will not merge its pull requests from here.`,
      review: null,
    }
  }

  const found = await loadReviewsForPr(db, {
    projectId: input.projectId,
    repo: `${owner}/${repo}`,
    aliases: [asked],
    repoId: pull.baseRepoId ?? null,
    number: input.number,
    fixAttemptId: input.fixAttemptId ?? null,
  })
  const gate = decidePrGate(found, currentHead, service ? SERVICE_CALLER : input, input.fixAttemptId ?? null)
  if (!gate.ok) return gate
  // A service merge needs a current "merge" verdict on this exact head: no
  // review, a stale one or a fix-first is a person's call (ADR 0035).
  if (service && (gate.review.state !== 'merge' || gate.review.headSha !== currentHead || gate.overridden || gate.mergedBeforeReview)) {
    return {
      ok: false,
      status: 409,
      code: 'REVIEW_NOT_MERGE',
      message: 'Mushi merges on its own only when the Opus review of this exact commit says merge.',
      review: gate.review,
    }
  }

  const linked = gate.reviewIds.length > 0
  const result = await mergeGithubPullRequest(input.token, ref, input.number, {
    ...input.merge,
    // Pin the commit whenever a review is linked or the caller named one:
    // new commits after the check make GitHub refuse instead of merging code
    // nobody reviewed.
    ...(input.expectedHeadSha ? { sha: input.expectedHeadSha } : linked ? { sha: gate.expectedHeadSha ?? currentHead } : {}),
  })

  // Every merge Mushi makes records the head it merged and the merge commit
  // on the linked fix attempts (ADR 0035), here where every merge route and
  // the fix-verifier pass, so the 72-hour regression watch cannot miss one.
  const mergedHead = input.expectedHeadSha ?? (linked ? (gate.expectedHeadSha ?? currentHead) : currentHead)
  if (result.merged && !result.alreadyMerged && result.sha && mergedHead && gate.attemptIds.length > 0) {
    await recordMergedHeads(db, gate.attemptIds, mergedHead, result.sha)
  }

  const audit: Record<string, unknown> = linked || gate.attemptIds.length > 0 || service
    ? {
        fix_attempt_ids: gate.attemptIds,
        review_state: gate.review.state,
        merged_head_sha: input.expectedHeadSha ?? (linked ? (gate.expectedHeadSha ?? currentHead) : null),
        ...(service ? { merged_by: 'service', service_reason: input.reason ?? null } : {}),
        ...(gate.overridden ? { review_override: true, override_reason: input.overrideReason } : {}),
        ...(gate.mergedBeforeReview ? { merged_before_review: true } : {}),
      }
    : {}
  return { ok: true, result, gate, audit }
}

/** recordMergedHead for each linked attempt. Never throws: the merge already happened. */
async function recordMergedHeads(db: SupabaseClient, attemptIds: string[], headSha: string, mergeSha: string): Promise<void> {
  try {
    const { data } = await db.from('fix_attempts').select('id, project_id, report_id, pr_url, pr_number').in('id', attemptIds)
    const mergedAt = new Date().toISOString()
    for (const a of (data ?? []) as MergedHeadTarget[]) {
      await recordMergedHead(db, a, { headSha, mergeSha, mergedAt })
    }
  } catch {
    // The regression watch misses this merge; the merge itself stands.
  }
}
