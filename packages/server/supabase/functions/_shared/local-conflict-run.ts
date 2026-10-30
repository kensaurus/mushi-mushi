/**
 * FILE: packages/server/supabase/functions/_shared/local-conflict-run.ts
 * PURPOSE: `mushi work --conflicts` claims and finishes one merge-queue
 *          conflict without a cloud Cursor key (ADR 0049's rules, one-shot
 *          instead of a daemon lane). The queue row is locked with
 *          `cursor_agent_id = local:<token>` so the merge-queue tick does not
 *          start a cloud agent on it and a second CLI cannot take it.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
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
  if (run.outcome === 'pushed' && run.headAfter && !requeue) {
    patch.state = 'blocked'
    patch.detail = 'Merge conflict. `mushi work --conflicts` reported a push without a commit sha.'
  }
  return { patch, requeue }
}
