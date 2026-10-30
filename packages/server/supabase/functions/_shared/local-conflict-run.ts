/**
 * FILE: packages/server/supabase/functions/_shared/local-conflict-run.ts
 * PURPOSE: `mushi work --conflicts` claims and finishes one merge-queue
 *          conflict without a cloud Cursor key (ADR 0049's rules, one-shot
 *          instead of a daemon lane). The queue row is locked with
 *          `cursor_agent_id = local:<token>` so the merge-queue tick does not
 *          start a cloud agent on it and a second CLI cannot take it.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 * A push with no commit sha blocks the row. A push that arrives after the
 * 90-minute free (the row is no longer held) still names the new head.
 */

import { MAX_CONFLICT_AGENTS } from './merge-queue.ts'
import { conflictRowAfterRun, conflictSlotBack, conflictWaiting, type ConflictQueueRow } from './work-modes.ts'

/** Prefix on `fix_merge_queue.cursor_agent_id` while `mushi work --conflicts` holds the row. */
export const LOCAL_CONFLICT_AGENT_PREFIX = 'local:'

const SHA_RE = /^[0-9a-f]{40}$/i
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isLocalConflictAgent(id: string | null | undefined): boolean {
  return !!id && id.startsWith(LOCAL_CONFLICT_AGENT_PREFIX)
}

export function localConflictAgentId(token: string): string {
  return `${LOCAL_CONFLICT_AGENT_PREFIX}${token}`
}

export function localConflictToken(id: string | null | undefined): string | null {
  if (!isLocalConflictAgent(id)) return null
  const token = id!.slice(LOCAL_CONFLICT_AGENT_PREFIX.length)
  return TOKEN_RE.test(token) ? token : null
}

/** Why `mushi work --conflicts` may not take this row, or null. */
export function localConflictClaimRefusal(row: ConflictQueueRow & { fix_attempt_id?: string }, branch: string | null): string | null {
  if (row.cursor_agent_id || row.local_claim_id) return 'A conflict agent is already working on this pull request.'
  if (!conflictWaiting(row)) return 'This pull request is not waiting on a merge conflict.'
  if ((row.conflict_agents ?? 0) >= MAX_CONFLICT_AGENTS) {
    return `Both conflict agents (${MAX_CONFLICT_AGENTS} of ${MAX_CONFLICT_AGENTS}) were used on this pull request.`
  }
  if (!row.head_sha || !SHA_RE.test(row.head_sha)) return 'Mushi has not recorded the pull request\'s head commit yet.'
  if (!branch) return 'Mushi did not record the pull request\'s branch.'
  return null
}

/** The compare-and-set that locks the row for one CLI run. */
export function localConflictClaimPatch(row: Pick<ConflictQueueRow, 'head_sha' | 'conflict_agents'>, token: string, nowIso: string): Record<string, unknown> {
  return {
    state: 'resolving',
    cursor_agent_id: localConflictAgentId(token),
    agent_started_at: nowIso,
    agent_head_sha: row.head_sha,
    conflict_agents: (row.conflict_agents ?? 0) + 1,
    detail: 'Merge conflict: `mushi work --conflicts` is merging the base branch into the pull request.',
    updated_at: nowIso,
    claimed_until: null,
  }
}

export interface LocalConflictDone {
  outcome: string
  failureKind: string | null
  detail: string | null
  headAfter: string | null
}

/** The queue patch when the CLI run ends. A push re-queues the Opus review. */
export function localConflictDonePatch(
  row: Pick<ConflictQueueRow, 'conflict_agents'>,
  run: LocalConflictDone,
): { patch: Record<string, unknown>; requeue: boolean } {
  const patch: Record<string, unknown> = {
    ...conflictRowAfterRun({ ...run, laneName: 'mushi work --conflicts' }),
    cursor_agent_id: null,
  }
  const n = row.conflict_agents ?? 0
  if (conflictSlotBack(run.outcome, run.failureKind) && n > 0) patch.conflict_agents = n - 1
  const requeue = run.outcome === 'pushed' && !!run.headAfter && SHA_RE.test(run.headAfter)
  // The done route turns a non-sha into null before this runs, so a missing
  // head and a garbage head are the same refusal. Do not keep a non-sha as head_sha.
  if (run.outcome === 'pushed' && !requeue) {
    patch.state = 'blocked'
    patch.detail = 'Merge conflict. `mushi work --conflicts` reported a push without a commit sha.'
    delete patch.head_sha
  }
  return { patch, requeue }
}

/**
 * The CLI's done call arrived after this run no longer holds the row (the
 * 90-minute free, or another agent took it while the push was in flight).
 * A real commit sha still moves the queue onto that head. Anything else,
 * and a row already merged or removed, stays `CONFLICT_NOT_HELD`.
 */
export function localConflictUnheldDone(
  row: Pick<ConflictQueueRow, 'state' | 'head_sha' | 'cursor_agent_id' | 'local_claim_id' | 'conflict_agents'>,
  run: Pick<LocalConflictDone, 'outcome' | 'headAfter'>,
): { action: 'already'; state: string } | { action: 'adopt'; patch: Record<string, unknown> } | { action: 'refuse' } {
  const head = run.outcome === 'pushed' && run.headAfter && SHA_RE.test(run.headAfter) ? run.headAfter.toLowerCase() : null
  if (!head) return { action: 'refuse' }
  if ((row.state === 'waiting' || row.state === 'queued') && row.head_sha === head) {
    return { action: 'already', state: row.state }
  }
  if (row.state === 'merged' || row.state === 'removed') return { action: 'refuse' }
  const patch: Record<string, unknown> = {
    state: 'waiting',
    head_sha: head,
    cursor_agent_id: null,
    local_claim_id: null,
    detail: `\`mushi work --conflicts\` pushed ${head.slice(0, 7)} after its hold ended; the queue checks it and Opus reviews the new head.`,
  }
  const n = row.conflict_agents ?? 0
  if ((row.cursor_agent_id || row.local_claim_id) && n > 0) patch.conflict_agents = n - 1
  return { action: 'adopt', patch }
}
