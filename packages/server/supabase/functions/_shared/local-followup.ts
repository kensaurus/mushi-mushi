/**
 * FILE: packages/server/supabase/functions/_shared/local-followup.ts
 * PURPOSE: Review follow-ups for pull requests a LOCAL agent opened through
 *          `mushi work` (fix_attempts.agent = 'mcp'), ADR 0032 amendment
 *          2026-10-24, and for cloud-agent PRs while the team's cloud
 *          follow-ups are off (amendment 2026-10-25). The review-followup worker only starts Cursor Cloud
 *          agents on cloud-agent PRs; a local PR that Opus said "fix first"
 *          about otherwise waits for a person. Here the CLI asks for one round,
 *          the server checks the same rules (the PR's live head is the reviewed
 *          one, at most FOLLOWUP_MAX_PER_PR rounds, once per head, no forks)
 *          and hands back the screened prompt; the local agent changes the
 *          working tree and the CLI pushes, which re-queues the review.
 *
 * Pure: the route reads the rows and GitHub, this decides.
 */

import { FOLLOWUP_MAX_PER_PR } from './review-followup.ts'

/** fix_attempts.agent for a fix made outside Mushi's cloud agents (`mushi work`, `submit_fix_result`). */
export const LOCAL_FIX_AGENT = 'mcp'

/**
 * Cloud-agent PRs a local agent may also follow up, but only while the
 * organization's cloud review follow-ups are off: then nothing else ever
 * works on their "fix first" findings (ADR 0032 amendment 2026-10-25).
 */
export const CLOUD_FIX_AGENTS: readonly string[] = ['cursor_cloud', 'github_cloud_agent']

/** Pure: whether a local follow-up may work on a fix this agent made. */
export function localFollowupAllowedFor(agent: string | null, cloudFollowupsOn: boolean): boolean {
  if (agent === LOCAL_FIX_AGENT) return true
  return !cloudFollowupsOn && agent != null && CLOUD_FIX_AGENTS.includes(agent)
}

/** fix_events.dedupe_key of a claimed local round: one per (fix, reviewed head). */
export function localFollowupDedupe(fixAttemptId: string, headSha: string): string {
  return `local-followup:${fixAttemptId}:${headSha}`
}

export interface LocalFollowupInput {
  attempt: { agent: string | null; pr_url: string | null; merged_at: string | null; pr_state: string | null } | null
  review: { status: string; verdict: string | null; head_sha: string | null } | null
  livePr: { open: boolean; headSha: string | null; headRef: string | null; headRepoId: number | null; baseRepoId: number | null } | null
  /** Heads a follow-up round (local, or a cloud agent that started) already ran for on this fix. */
  roundHeads: readonly string[]
  /** The organization's cloud review follow-ups (`organizations.review_followup_enabled`). */
  cloudFollowupsOn: boolean
}

export type LocalFollowupGate =
  | { ok: true; headSha: string; branch: string; round: number }
  | { ok: false; status: 404 | 409 | 503; code: string; message: string }

/** Whether one local follow-up round may start now, and if not, exactly why. */
export function localFollowupGate(input: LocalFollowupInput): LocalFollowupGate {
  const { attempt, review, livePr } = input
  if (!attempt) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Fix not found.' }
  if (!localFollowupAllowedFor(attempt.agent, input.cloudFollowupsOn)) {
    return {
      ok: false,
      status: 409,
      code: 'NOT_LOCAL',
      message: input.cloudFollowupsOn && attempt.agent != null && CLOUD_FIX_AGENTS.includes(attempt.agent)
        ? `This fix was made by ${attempt.agent}, and review follow-ups are on for this team: Mushi's follow-up worker handles it.`
        : `This fix was made by ${attempt.agent ?? 'an unknown agent'}; local follow-ups only work on local and cloud-agent pull requests.`,
    }
  }
  if (!attempt.pr_url) return { ok: false, status: 409, code: 'NO_PR', message: 'This fix has no pull request.' }
  if (attempt.merged_at || attempt.pr_state === 'merged' || attempt.pr_state === 'closed') {
    return { ok: false, status: 409, code: 'PR_NOT_OPEN', message: 'The pull request is already merged or closed.' }
  }
  if (!review || review.status === 'queued' || review.status === 'running') {
    return {
      ok: false,
      status: 409,
      code: 'REVIEW_PENDING',
      message: review ? 'The Opus review of this pull request is still running; try again when it finishes.' : 'This pull request has no Opus review yet.',
    }
  }
  if (review.status !== 'completed' || review.verdict !== 'fix_first') {
    return {
      ok: false,
      status: 409,
      code: 'NOT_FIX_FIRST',
      message: review.status === 'completed'
        ? `The latest Opus review says "${review.verdict ?? 'no verdict'}", not "fix first": nothing to follow up.`
        : `The latest Opus review did not finish (${review.status}): nothing to follow up.`,
    }
  }
  if (!livePr) return { ok: false, status: 503, code: 'PR_UNREADABLE', message: 'GitHub could not be read for this pull request; try again in a minute.' }
  if (!livePr.open) return { ok: false, status: 409, code: 'PR_NOT_OPEN', message: 'The pull request is already merged or closed.' }
  if (!livePr.headSha || !livePr.headRef) return { ok: false, status: 503, code: 'PR_UNREADABLE', message: "GitHub did not return the pull request's head." }
  if (livePr.headRepoId == null || livePr.baseRepoId == null || livePr.headRepoId !== livePr.baseRepoId) {
    return { ok: false, status: 409, code: 'FORK', message: 'The pull request comes from a fork; follow-ups only push to branches in the base repository.' }
  }
  if (review.head_sha !== livePr.headSha) {
    return {
      ok: false,
      status: 409,
      code: 'REVIEW_STALE',
      message: `The review is about ${String(review.head_sha ?? 'an unknown commit').slice(0, 7)}, but the pull request is now at ${livePr.headSha.slice(0, 7)}; wait for the review of the new commit.`,
    }
  }
  if (input.roundHeads.includes(livePr.headSha)) {
    return { ok: false, status: 409, code: 'ALREADY_FOLLOWED_UP', message: `A follow-up already ran for ${livePr.headSha.slice(0, 7)}; the next one waits for a review of a new commit.` }
  }
  if (input.roundHeads.length >= FOLLOWUP_MAX_PER_PR) {
    return {
      ok: false,
      status: 409,
      code: 'ROUNDS_USED',
      message: `${input.roundHeads.length} follow-up rounds already ran on this pull request (the limit is ${FOLLOWUP_MAX_PER_PR}); a person decides what happens next.`,
    }
  }
  return { ok: true, headSha: livePr.headSha, branch: livePr.headRef, round: input.roundHeads.length + 1 }
}
