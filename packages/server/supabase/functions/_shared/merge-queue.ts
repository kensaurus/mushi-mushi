/**
 * FILE: packages/server/supabase/functions/_shared/merge-queue.ts
 * PURPOSE: "Merge when ready" (ADR 0041): what the queue does next with one
 *          pull request a person queued, from GitHub's view of it and of the
 *          checks on its head.
 *
 *          On 2026-10-23 a console bulk merge of 4 Opus-approved PRs merged
 *          1: the repos require branches to be up to date, so every merge
 *          left the others BEHIND ("Required status check is expected"), and
 *          agent PRs that touch the same files conflicted. Merging 79 such
 *          PRs by hand is update branch → wait for CI → merge, one at a time
 *          per repo. The queue does exactly that, and asks a Cursor agent to
 *          resolve a conflict.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

export const MERGE_QUEUE_STATES = ['queued', 'waiting', 'resolving', 'blocked', 'merged', 'removed'] as const
export type MergeQueueState = (typeof MERGE_QUEUE_STATES)[number]

/** A conflict gets at most this many agent runs; then a person decides. */
export const MAX_CONFLICT_AGENTS = 2
/** An agent that has not pushed after this long is given up. */
export const CONFLICT_AGENT_TIMEOUT_MS = 90 * 60_000

export interface PullView {
  state: string | null
  merged: boolean
  draft: boolean
  mergeable: boolean | null
  mergeableState: string | null
  headSha: string | null
}

export interface ChecksView {
  /** Check runs not finished on the head. */
  pending: number
  /** Names of check runs that failed on the head. */
  failed: string[]
  /** Names of check runs that finished and were not skipped. Absent: not read. */
  ran?: string[]
}

/**
 * Whether a head's failed checks are the base branch's, not its own: at
 * least one also fails on the base, and every other one fails there too or
 * did not run there. The second rule sees through aggregator jobs: glot.it's
 * `gate` fails whenever a job it needs fails, but on main it is skipped, so
 * comparing names alone blamed the members for main's red npm audit
 * (2026-10-26).
 */
export function failuresOnBase(failed: string[], base: ChecksView): boolean {
  const baseFailed = new Set(base.failed)
  if (!failed.some((n) => baseFailed.has(n))) return false
  const ran = base.ran ? new Set(base.ran) : null
  return failed.every((n) => baseFailed.has(n) || (ran !== null && !ran.has(n)))
}

export type QueueStep =
  | { do: 'done' }
  | { do: 'drop'; reason: string }
  | { do: 'merge' }
  | { do: 'ready' }
  | { do: 'update' }
  | { do: 'wait'; reason: string }
  | { do: 'resolve' }
  | { do: 'blocked'; reason: string }

/**
 * The next step. Order matters: a conflict is resolved before anything else
 * (CI on a conflicting head says nothing about the merge); a branch behind
 * its base is updated even while its old checks run, since those will be
 * superseded; failed checks block (a CI-repair follow-up may fix them, and
 * the queue looks again on every tick).
 */
export function nextQueueStep(pr: PullView, checks: ChecksView): QueueStep {
  if (pr.merged) return { do: 'done' }
  if (pr.state && pr.state !== 'open') return { do: 'drop', reason: 'The pull request was closed without merging.' }
  if (pr.draft) return { do: 'ready' }
  const s = (pr.mergeableState ?? 'unknown').toLowerCase()
  if (s === 'dirty' || pr.mergeable === false) return { do: 'resolve' }
  if (s === 'behind') return { do: 'update' }
  if (pr.mergeable == null || s === 'unknown') return { do: 'wait', reason: 'GitHub is still working out whether it can merge.' }
  if (checks.failed.length) {
    return { do: 'blocked', reason: `CI failed: ${checks.failed.slice(0, 4).join(', ')}. A CI-repair agent may fix it (review follow-ups); the queue looks again after each push.` }
  }
  if (checks.pending > 0) return { do: 'wait', reason: `CI is running (${checks.pending} check${checks.pending === 1 ? '' : 's'} left).` }
  if (s === 'clean' || s === 'unstable' || s === 'has_hooks') return { do: 'merge' }
  if (s === 'blocked') return { do: 'blocked', reason: 'Branch protection blocks it (a required review or check is missing).' }
  return { do: 'wait', reason: `GitHub says "${s}".` }
}

/**
 * What a refused gated merge means for the queue row, in words the console
 * shows (2026-10-23: "Mushi merges on its own only when the Opus review of this
 * exact commit says merge" told nobody what to do). A held row does not hold
 * its repo; it is looked at again whenever nothing else there moves.
 */
export function reviewRefusal(
  code: string,
  message: string,
  review: { verdict?: string | null; stale?: boolean; rerunning?: boolean } | null,
): { state: 'waiting' | 'blocked'; detail: string; requeueReview: boolean } {
  if (code === 'HEAD_MOVED' || code === 'REVIEW_PENDING') return { state: 'waiting', detail: message, requeueReview: false }
  const verdict = review?.verdict ?? null
  if (verdict === 'merge' && (review?.stale || review?.rerunning)) {
    return { state: 'waiting', detail: 'Opus is reviewing the updated commit; it merges when the verdict is merge.', requeueReview: !review?.rerunning }
  }
  if (verdict === 'fix_first') {
    return {
      state: 'blocked',
      detail: 'Opus says fix first on this commit. With review follow-ups on, an agent fixes its findings and Opus reviews the push; the queue merges it once the verdict is merge.',
      requeueReview: false,
    }
  }
  if (verdict === 'hold' || code === 'REVIEW_HOLD') {
    return { state: 'blocked', detail: 'Opus says hold on this commit. Open the fix to read why; only you can override a hold.', requeueReview: false }
  }
  if (!verdict) {
    return { state: 'blocked', detail: 'This pull request has no Opus review yet. Start one from the fix (Review), or merge it yourself.', requeueReview: false }
  }
  return { state: 'blocked', detail: message, requeueReview: false }
}

/**
 * The check runs of a head, reduced to what `nextQueueStep` reads. A name
 * that ran more than once counts by its newest run: a draft's CI stops on
 * purpose ("Draft PRs run no CI") and runs again on the same commit once
 * the PR is marked ready, so the old stop must not read as a failure.
 */
export function checksView(runs: Array<{ id?: number; name?: string; status?: string; conclusion?: string | null; started_at?: string | null }>): ChecksView {
  const newest = new Map<string, (typeof runs)[number]>()
  runs.forEach((r, i) => {
    const key = r.name ?? `#${i}`
    const prev = newest.get(key)
    const later = !prev || (r.started_at ?? '') > (prev.started_at ?? '') || ((r.started_at ?? '') === (prev.started_at ?? '') && (r.id ?? 0) > (prev.id ?? 0))
    if (later) newest.set(key, r)
  })
  let pending = 0
  const failed: string[] = []
  const ran: string[] = []
  for (const r of newest.values()) {
    if (r.status !== 'completed') pending++
    else {
      if (r.conclusion && ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(r.conclusion)) failed.push(r.name ?? 'a check')
      if (r.conclusion !== 'skipped') ran.push(r.name ?? 'a check')
    }
  }
  return { pending, failed, ran }
}

/** The task a Cursor agent gets for a conflicting PR. Pure text; no report content goes in. */
export function conflictPrompt(args: { prUrl: string; baseRef: string; headRef: string }): string {
  return [
    `This pull request has merge conflicts with \`${args.baseRef}\`: ${args.prUrl}`,
    '',
    `1. On branch \`${args.headRef}\`, merge the latest \`${args.baseRef}\` (\`git fetch origin ${args.baseRef} && git merge origin/${args.baseRef}\`).`,
    `2. Resolve every conflict so both this pull request's change and what \`${args.baseRef}\` added since are kept. Do not drop either side to make the merge easy.`,
    '3. Run the project\'s type check, lint and the tests for the files you touched; fix what the merge broke.',
    '4. Push the merge commit to the same branch. Do not open a new pull request, change anything unrelated, or weaken a test.',
    '',
    'If a conflict needs a product decision (both sides change the same behaviour in incompatible ways), push nothing and make the first line of your final message `Mushi verdict: needs_human`, then say which files and why.',
  ].join('\n')
}

/** One line for the console about a row. */
export function queueLine(row: { state: MergeQueueState; detail: string | null }): string {
  switch (row.state) {
    case 'queued':
      return 'Queued to merge.'
    case 'waiting':
      return row.detail ?? 'Waiting.'
    case 'resolving':
      return row.detail ?? 'A Cursor agent is resolving the merge conflict.'
    case 'blocked':
      return row.detail ?? 'Needs you.'
    case 'merged':
      return 'Merged.'
    case 'removed':
      return 'Taken out of the queue.'
  }
}
