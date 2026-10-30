/**
 * FILE: packages/server/supabase/functions/_shared/auto-decide.ts
 * PURPOSE: "Decide for me" (ADR 0055): what Mushi does with an open agent fix
 *          PR when no person will, from what the Opus review (ADR 0030)
 *          already stored and what GitHub says now. No model is asked again:
 *          Opus judges the code, this file only maps its verdict to an action.
 *
 *          On 2026-10-30 the owner's apps held 607 open fix PRs. About 250
 *          had an Opus "merge" verdict but nobody put them in the merge queue
 *          (ADR 0041 waits for a person), and 157 "hold" PRs waited for a
 *          person who never came. The owner asked: "do the judgment for me
 *          please - make it fully automated".
 *
 *          The rules, in order:
 *            - the PR is closed or merged on GitHub → record it, nothing else;
 *            - the report is closed, or another open PR for it is better →
 *              close this one as superseded;
 *            - no finished review on the PR's head yet → wait (or ask Opus
 *              again when the verdict is about an older head);
 *            - "merge" and CI not red → queue it (trains merge it, ADR 0044);
 *            - "merge" with red CI, or "fix first" → give the follow-up and
 *              CI-repair agents (ADR 0032) their time, then close and redo;
 *            - "hold" → close and redo after a short grace;
 *          and a redo is a fresh fix with the review's findings in its
 *          prompt, at most MAX_PR_ATTEMPTS_PER_REPORT pull requests per
 *          report; after that the report waits for a person.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

/** Pull requests one report may get before Mushi stops trying on its own. */
export const MAX_PR_ATTEMPTS_PER_REPORT = 3
/** A hold is acted on this long after its review, so a person who is looking can still step in. */
export const HOLD_GRACE_MS = 6 * 3600_000
/** "fix first" and red CI get this long for the follow-up and CI-repair agents. */
export const REPAIR_GRACE_MS = 48 * 3600_000
/** A PR checked recently is not read from GitHub again before this. */
export const RECHECK_MS = 20 * 60_000
/** PRs looked at per tick (each costs two GitHub reads). */
export const PRS_PER_TICK = 30

export type ReviewStatus = 'queued' | 'running' | 'completed' | 'skipped' | 'failed'
export type Verdict = 'merge' | 'fix_first' | 'hold'
export type OwnCi = 'green' | 'red' | 'pending' | 'unknown'

export interface DecideInput {
  /** GitHub now. */
  pr: { open: boolean; merged: boolean; headSha: string | null }
  report: { closed: boolean }
  /** Another open PR of the same report ranks above this one (pickKeeper). */
  superseded: boolean
  /** The latest review row of this PR; null when none was ever queued. */
  review: {
    status: ReviewStatus
    verdict: Verdict | null
    headSha: string | null
    fixesReport: boolean | null
    skipReason: string | null
    completedAt: string | null
  } | null
  /** CI on the PR's own head. */
  ci: OwnCi
  /** A review follow-up or CI-repair agent is queued or running on this PR. */
  repairActive: boolean
  /** Pull requests this report has had, this one included. */
  prAttempts: number
  now: Date
}

export type Decision =
  | { do: 'synced'; reason: string }
  | { do: 'wait'; reason: string }
  | { do: 'rereview'; reason: string }
  | { do: 'queue'; reason: string }
  | { do: 'close_superseded'; reason: string }
  | { do: 'close_redo'; reason: string }
  | { do: 'close_park'; reason: string }

function age(at: string | null, now: Date): number {
  const t = at ? Date.parse(at) : NaN
  return Number.isFinite(t) ? now.getTime() - t : 0
}

function closeOrPark(reason: string, prAttempts: number): Decision {
  if (prAttempts >= MAX_PR_ATTEMPTS_PER_REPORT) {
    return { do: 'close_park', reason: `${reason} This report has had ${prAttempts} pull requests, so Mushi stops trying on its own; a person decides what is next.` }
  }
  return { do: 'close_redo', reason: `${reason} Mushi closes it and starts a new fix that is told what this review found.` }
}

export function decideFix(input: DecideInput): Decision {
  const { pr, review, now } = input
  if (pr.merged) return { do: 'synced', reason: 'Merged on GitHub.' }
  if (!pr.open) return { do: 'synced', reason: 'Closed on GitHub.' }
  if (input.report.closed) return { do: 'close_superseded', reason: 'The report is already closed, so this pull request is no longer needed.' }
  if (input.superseded) return { do: 'close_superseded', reason: 'Another open pull request for the same report is further along.' }

  if (!review) return { do: 'wait', reason: 'No review yet.' }
  if (review.status === 'queued' || review.status === 'running') return { do: 'wait', reason: 'Opus is reviewing it.' }
  if (review.status === 'skipped') return { do: 'wait', reason: `The review was skipped (${review.skipReason ?? 'no reason'}); it runs again when it can.` }
  if (review.status === 'failed' || !review.verdict) return { do: 'wait', reason: 'The review did not finish.' }
  if (review.headSha && pr.headSha && review.headSha !== pr.headSha) {
    return { do: 'rereview', reason: 'The pull request has new commits since its review.' }
  }

  const reviewAge = age(review.completedAt, now)
  if (review.verdict === 'merge') {
    if (input.ci !== 'red') return { do: 'queue', reason: 'Opus says merge on its current commit.' }
    if (input.repairActive || reviewAge < REPAIR_GRACE_MS) return { do: 'wait', reason: 'CI is red; a CI-repair agent gets its turn first.' }
    return closeOrPark('Opus approved it, but its CI stayed red after the repair window.', input.prAttempts)
  }
  if (review.verdict === 'fix_first') {
    if (input.repairActive || reviewAge < REPAIR_GRACE_MS) return { do: 'wait', reason: 'Opus asked for changes; a follow-up agent gets its turn first.' }
    return closeOrPark('Opus still asks for changes after the follow-up window.', input.prAttempts)
  }
  // hold
  if (reviewAge < HOLD_GRACE_MS) return { do: 'wait', reason: 'Opus says do not merge; Mushi acts on it a few hours after the review.' }
  return closeOrPark(
    review.fixesReport === false ? 'Opus says this pull request does not fix the report.' : 'Opus says do not merge this pull request as it is.',
    input.prAttempts,
  )
}

const VERDICT_RANK: Record<string, number> = { merge: 3, fix_first: 2, none: 1, hold: 0 }

/**
 * Of a report's open PRs, the one to keep: the best latest verdict, then the
 * newest. The others are superseded.
 */
export function pickKeeper<T extends { id: string; verdict: Verdict | null; createdAt: string }>(prs: readonly T[]): T | null {
  if (prs.length === 0) return null
  return [...prs].sort((a, b) => {
    const r = VERDICT_RANK[b.verdict ?? 'none'] - VERDICT_RANK[a.verdict ?? 'none']
    return r !== 0 ? r : Date.parse(b.createdAt) - Date.parse(a.createdAt)
  })[0]
}

/** The comment Mushi leaves on a PR it closes. */
export function closeComment(decision: Decision, reviewUrl: string | null): string {
  const lines = [`Mushi Mushi closed this pull request on its own ("Decide for me" is on for this app).`, '', decision.reason]
  if (reviewUrl) lines.push('', `Review: ${reviewUrl}`)
  lines.push('', 'Reopen it to keep it, or turn "Decide for me" off in the Fixes page.')
  return lines.join('\n')
}

/** CI on a head from the merge queue's check view. */
export function ownCi(checks: { pending: number; failed: string[]; ran?: string[] }): OwnCi {
  if (checks.failed.length > 0) return 'red'
  if (checks.pending > 0) return 'pending'
  if (checks.ran && checks.ran.length > 0) return 'green'
  return 'unknown'
}

/** owner/repo of a GitHub pull request URL; null for anything else. */
export function prRepoRef(prUrl: string | null | undefined): { owner: string; repo: string } | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/\d+/.exec(prUrl ?? '')
  return m ? { owner: m[1], repo: m[2] } : null
}
