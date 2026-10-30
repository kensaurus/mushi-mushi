/**
 * FILE: local-conflict-run.test.ts
 * PURPOSE: `mushi work --conflicts` locks a merge-queue row with
 *          `cursor_agent_id = local:<token>` and records the push or the
 *          refusal (local-conflict-run.ts). A push re-queues the review only
 *          when the new head is a commit sha.
 */
import { describe, expect, it } from 'vitest'
import {
  localConflictClaimPatch,
  localConflictClaimRefusal,
  localConflictDonePatch,
} from '../../supabase/functions/_shared/local-conflict-run.ts'
import type { ConflictQueueRow } from '../../supabase/functions/_shared/work-modes.ts'

const SHA = 'ab'.repeat(20)
const NEXT = 'cd'.repeat(20)

const row = (over: Partial<ConflictQueueRow> = {}): ConflictQueueRow => ({
  id: 'q1',
  project_id: 'p1',
  repo: 'o/r',
  pr_number: 7,
  state: 'resolving',
  detail: 'Conflicts with the base branch.',
  head_sha: SHA,
  conflict_agents: 0,
  cursor_agent_id: null,
  local_claim_id: null,
  claimed_until: null,
  queued_at: '2026-10-23T08:00:00Z',
  ...over,
})

describe('local conflict claim', () => {
  it('refuses a row that already has an agent, is over the cap, or has no head', () => {
    expect(localConflictClaimRefusal(row({ cursor_agent_id: 'bc-1' }), 'fix')).toMatch(/already working/)
    expect(localConflictClaimRefusal(row({ conflict_agents: 2 }), 'fix')).toMatch(/Both conflict agents/)
    expect(localConflictClaimRefusal(row({ head_sha: null }), 'fix')).toMatch(/head commit/)
    expect(localConflictClaimRefusal(row(), null)).toMatch(/branch/)
    expect(localConflictClaimRefusal(row(), 'cursor/fix-1')).toBeNull()
  })

  it('locks the row for this CLI and counts the attempt', () => {
    const patch = localConflictClaimPatch(row(), '00000000-0000-4000-8000-0000000000aa', '2026-10-23T09:00:00Z')
    expect(patch.cursor_agent_id).toBe('local:00000000-0000-4000-8000-0000000000aa')
    expect(patch.state).toBe('resolving')
    expect(patch.conflict_agents).toBe(1)
    expect(patch.agent_head_sha).toBe(SHA)
  })
})

describe('local conflict done', () => {
  it('a push with a commit sha goes back to waiting and re-queues the review', () => {
    const { patch, requeue } = localConflictDonePatch(row({ conflict_agents: 1 }), {
      outcome: 'pushed',
      failureKind: null,
      detail: 'merged',
      headAfter: NEXT,
    })
    expect(requeue).toBe(true)
    expect(patch.state).toBe('waiting')
    expect(patch.head_sha).toBe(NEXT)
    expect(patch.cursor_agent_id).toBeNull()
    expect(patch.conflict_agents).toBeUndefined()
  })

  it('a refusal keeps the cap slot; a skip gives it back', () => {
    const refused = localConflictDonePatch(row({ conflict_agents: 1 }), {
      outcome: 'refused',
      failureKind: 'code',
      detail: 'conflict markers remain',
      headAfter: null,
    })
    expect(refused.requeue).toBe(false)
    expect(refused.patch.state).toBe('blocked')
    expect(String(refused.patch.detail).startsWith('Merge conflict')).toBe(true)
    expect(refused.patch.conflict_agents).toBeUndefined()

    const skipped = localConflictDonePatch(row({ conflict_agents: 1 }), {
      outcome: 'skipped',
      failureKind: null,
      detail: 'the pull request is closed',
      headAfter: null,
    })
    expect(skipped.patch.conflict_agents).toBe(0)
  })

  it('a push without a commit sha does not re-queue the review', () => {
    const { patch, requeue } = localConflictDonePatch(row({ conflict_agents: 1 }), {
      outcome: 'pushed',
      failureKind: null,
      detail: 'pushed',
      headAfter: 'not-a-sha',
    })
    expect(requeue).toBe(false)
    expect(patch.state).toBe('blocked')
    expect(String(patch.detail)).toContain('without a commit sha')
  })
})
