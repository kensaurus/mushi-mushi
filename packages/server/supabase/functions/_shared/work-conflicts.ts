/**
 * FILE: packages/server/supabase/functions/_shared/work-conflicts.ts
 * PURPOSE: The database side of the local worker's `conflicts` mode (ADR
 *          0049, amends ADR 0032, under ADR 0041's cap of 2 conflict agents
 *          per PR, cloud and local counted together). Used by
 *          api/routes/work.ts (served by `api-ext`).
 *
 *          A claim takes a fix_merge_queue row with one compare-and-set that
 *          the merge-queue tick's own row lease also respects (it compares
 *          local_claim_id), so a cloud agent never starts on a row a lane
 *          holds. Ending the claim frees the row with what happened, gives
 *          the cap slot back when the machine was at fault, and after a push
 *          re-queues the Opus review of the new head. The rules are in
 *          _shared/work-modes.ts.
 */

import type { getServiceClient } from './db.ts'
import { log } from './logger.ts'
import { requeueReviewForNewHead } from './fix-review-db.ts'
import type { ClaimDone } from './work-lanes.ts'
import { conflictClaimBlock, conflictRowAfterRun, conflictSlotBack, rankConflictRows, type ConflictQueueRow } from './work-modes.ts'

type Db = ReturnType<typeof getServiceClient>

const mlog = log.child('work-conflicts')
const QUEUE_COLUMNS = 'id, project_id, fix_attempt_id, repo, pr_number, state, detail, head_sha, conflict_agents, cursor_agent_id, local_claim_id, claimed_until, queued_at'

export interface ModeLane {
  id: string
  host_id: string
  project_id: string
  name: string
  repo: string | null
  review_model: string | null
}

type QueueRow = ConflictQueueRow & { fix_attempt_id: string }

async function queueEvent(db: Db, row: { fix_attempt_id: string; project_id: string; repo: string; pr_number: number }, status: 'ok' | 'fail' | 'pending', label: string, detail: string, dedupe: string): Promise<void> {
  const { error } = await db.from('fix_events').insert({
    fix_attempt_id: row.fix_attempt_id,
    project_id: row.project_id,
    kind: 'merge_queue',
    status,
    label,
    detail: detail.slice(0, 500),
    at: new Date().toISOString(),
    dedupe_key: dedupe,
    payload: { repo: row.repo, pr: row.pr_number, local: true },
  })
  if (error && (error as { code?: string }).code !== '23505') mlog.warn('merge-queue event not written', { err: error.message })
}

// ── conflicts ───────────────────────────────────────────────────────────────

export interface ConflictClaim {
  claimId: string
  queueId: string
  repo: string
  prNumber: number
  headRef: string
  headSha: string
  prUrl: string | null
  fixAttemptId: string
}

/**
 * Claim the oldest conflict this lane may take: the claim row first (its
 * partial unique index lets one lane win a row), then one compare-and-set on
 * the queue row that also requires no cloud agent, no other local claim, the
 * conflict count Mushi read, the head it read, and no merge-queue tick
 * holding the row. Losing the second step deletes the claim and tries the next.
 */
export async function claimConflict(db: Db, lane: ModeLane, now: Date, leaseUntil: string): Promise<{ claim: ConflictClaim } | { reason: string }> {
  if (!lane.repo) return { reason: 'This worker does not say which repository the lane\'s clone is. Update the Mushi CLI on the machine.' }
  const { data, error } = await db
    .from('fix_merge_queue')
    .select(QUEUE_COLUMNS)
    .eq('project_id', lane.project_id)
    .in('state', ['resolving', 'blocked'])
    .order('queued_at', { ascending: true })
    .limit(100)
  if (error) throw new Error(`merge queue read failed: ${error.message}`)
  const rows = ((data ?? []) as QueueRow[]).filter((r) => r.repo.toLowerCase() === lane.repo)
  if (rows.length === 0) return { reason: `No PR of ${lane.repo} waits for a conflict agent.` }

  const [attempts, recent] = await Promise.all([
    db.from('fix_attempts').select('id, branch, pr_url').in('id', rows.map((r) => r.fix_attempt_id)),
    db.from('work_claims').select('merge_queue_id, finished_at, status').in('merge_queue_id', rows.map((r) => r.id)).neq('status', 'active').order('finished_at', { ascending: false }),
  ])
  if (attempts.error) throw new Error(`fix attempts read failed: ${attempts.error.message}`)
  if (recent.error) throw new Error(`conflict claims read failed: ${recent.error.message}`)
  const attemptById = new Map(((attempts.data ?? []) as Array<{ id: string; branch: string | null; pr_url: string | null }>).map((a) => [a.id, a]))
  const lastEnd = new Map<string, string>()
  for (const c of (recent.data ?? []) as Array<{ merge_queue_id: string; finished_at: string | null }>) {
    if (c.finished_at && !lastEnd.has(c.merge_queue_id)) lastEnd.set(c.merge_queue_id, c.finished_at)
  }
  const reasons: string[] = []
  const free = rankConflictRows(rows).filter((r) => {
    const a = attemptById.get(r.fix_attempt_id)
    const block = !a?.branch
      ? 'Mushi did not record the PR\'s branch.'
      : conflictClaimBlock(r, { laneRepo: lane.repo, branch: a.branch, lastLocalEndAt: lastEnd.get(r.id) ?? null, now })
    if (block) reasons.push(block)
    return !block
  })
  for (const row of free) {
    const attempt = attemptById.get(row.fix_attempt_id)!
    const { data: inserted, error: insErr } = await db
      .from('work_claims')
      .insert({ kind: 'conflict', merge_queue_id: row.id, report_id: null, lane_id: lane.id, host_id: lane.host_id, project_id: lane.project_id, status: 'active', lease_until: leaseUntil, claimed_at: now.toISOString() })
      .select('id')
      .single()
    if (insErr?.code === '23505') continue
    if (insErr || !inserted) throw new Error(`conflict claim insert failed: ${insErr?.message ?? 'no row'}`)
    const claimId = (inserted as { id: string }).id
    const n = row.conflict_agents ?? 0
    const nowIso = now.toISOString()
    const { data: taken, error: casErr } = await db
      .from('fix_merge_queue')
      .update({
        state: 'resolving',
        local_claim_id: claimId,
        conflict_agents: n + 1,
        agent_started_at: nowIso,
        agent_head_sha: row.head_sha,
        detail: `Merge conflict: a local worker (${lane.name}) is merging the base branch into the PR.`,
        updated_at: nowIso,
      })
      .eq('id', row.id)
      .eq('conflict_agents', n)
      .eq('head_sha', row.head_sha!)
      .is('cursor_agent_id', null)
      .is('local_claim_id', null)
      .in('state', ['resolving', 'blocked'])
      .or(`claimed_until.is.null,claimed_until.lt.${nowIso}`)
      .select('id')
    if (casErr || !taken || (taken as unknown[]).length === 0) {
      // A cloud agent, another lane or a merge-queue tick took the row in between.
      await db.from('work_claims').delete().eq('id', claimId)
      if (casErr) mlog.warn('conflict row compare-and-set failed', { rowId: row.id, err: casErr.message })
      continue
    }
    await queueEvent(db, row, 'pending', 'Merge queue: conflict sent to a local worker', `The local worker lane ${lane.name} is merging the base branch into this PR.`, `mq-local:${row.id}:${row.head_sha}`)
    return {
      claim: { claimId, queueId: row.id, repo: row.repo, prNumber: row.pr_number, headRef: attempt.branch!, headSha: row.head_sha!, prUrl: attempt.pr_url, fixAttemptId: row.fix_attempt_id },
    }
  }
  return { reason: reasons[0] ?? 'Another worker or agent took the waiting conflicts first.' }
}

/**
 * A conflict claim ended (done, or its lease ran out): free the queue row with
 * what happened, give the cap slot back when the machine was at fault, and
 * after a push re-queue the Opus review of the new head (the push webhook
 * also does; this does not wait for it).
 */
export async function endConflictClaim(
  db: Db,
  claim: { id: string; merge_queue_id: string | null },
  run: Pick<ClaimDone, 'outcome' | 'failureKind' | 'detail' | 'headAfter'> | { outcome: 'lease_expired'; failureKind: 'infra'; detail: string; headAfter: null },
  laneName: string,
  now: Date,
): Promise<void> {
  if (!claim.merge_queue_id) return
  const { data, error } = await db.from('fix_merge_queue').select(QUEUE_COLUMNS).eq('id', claim.merge_queue_id).maybeSingle()
  if (error || !data) {
    if (error) mlog.warn('conflict row unreadable at claim end', { claimId: claim.id, err: error.message })
    return
  }
  const row = data as QueueRow
  // Removed from the queue, merged, or taken over meanwhile: the run's end changes nothing there.
  if (row.local_claim_id !== claim.id || row.state !== 'resolving') return
  const patch: Record<string, unknown> = { ...conflictRowAfterRun({ ...run, laneName }), updated_at: now.toISOString(), claimed_until: null }
  const n = row.conflict_agents ?? 0
  if (conflictSlotBack(run.outcome, run.failureKind) && n > 0) patch.conflict_agents = n - 1
  const { data: moved } = await db.from('fix_merge_queue').update(patch).eq('id', row.id).eq('local_claim_id', claim.id).eq('state', 'resolving').select('id')
  if (!moved || (moved as unknown[]).length === 0) return
  if (run.outcome === 'pushed' && run.headAfter) {
    await queueEvent(db, row, 'ok', 'Conflict resolved by a local worker', `New head ${run.headAfter.slice(0, 7)}; the queue continues.`, `mq-resolved:${row.id}:${run.headAfter}`)
    const { data: att } = await db.from('fix_attempts').select('id, project_id, report_id, pr_url').eq('id', row.fix_attempt_id).maybeSingle()
    const a = att as { id: string; project_id: string; report_id: string | null; pr_url: string | null } | null
    if (a) {
      const r = await requeueReviewForNewHead(db, { fixAttemptId: a.id, projectId: a.project_id, reportId: a.report_id, prUrl: a.pr_url }, run.headAfter, now)
      if (r === 'error') mlog.warn('review not re-queued after a local merge', { rowId: row.id })
    }
  } else {
    await queueEvent(db, row, 'fail', 'Merge queue: the local worker did not resolve it', String(patch.detail ?? ''), `mq-local-end:${claim.id}`)
  }
}
