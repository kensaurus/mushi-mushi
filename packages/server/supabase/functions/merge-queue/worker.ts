// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
/**
 * merge-queue worker: one tick of "Merge when ready" (ADR 0041). Kept apart
 * from index.ts (which serves) so tests import it with fake GitHub and Cursor.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { GithubRepoRef, PullRequestDetails } from '../_shared/github.ts'
import type { gatedMergePullRequest } from '../_shared/gated-merge.ts'
import type { finalizeFixMerge } from '../_shared/fix-merge.ts'
import type { requeueReviewForNewHead } from '../_shared/fix-review-db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { canonicalPrUrl } from '../_shared/pr-substance.ts'
import { deterministicCursorAgentId, type CreateCursorAgentV1Input } from '../_shared/cursor-cloud.ts'
import {
  CONFLICT_AGENT_TIMEOUT_MS,
  MAX_CONFLICT_AGENTS,
  conflictPrompt,
  nextQueueStep,
  type ChecksView,
} from '../_shared/merge-queue.ts'

const log = rootLog.child('merge-queue')
const LEASE_MS = 4 * 60_000
const BLOCKED_RECHECKS_PER_TICK = 10

export interface QueueRow {
  id: string
  fix_attempt_id: string
  project_id: string
  repo: string
  pr_number: number
  state: string
  detail: string | null
  head_sha: string | null
  queued_by: string | null
  conflict_agents: number
  cursor_agent_id: string | null
  agent_started_at: string | null
  agent_head_sha: string | null
}

const ROW_COLUMNS =
  'id, fix_attempt_id, project_id, repo, pr_number, state, detail, head_sha, queued_by, conflict_agents, cursor_agent_id, agent_started_at, agent_head_sha, queued_at, claimed_until'

/** Everything that talks to GitHub, Cursor or the merge path; index.ts wires the live ones. */
export interface MergeQueueDeps {
  now?: () => Date
  token: (db: SupabaseClient, attempt: AttemptRow) => Promise<string | null>
  pull: (token: string, ref: GithubRepoRef, n: number) => Promise<PullRequestDetails | null>
  checks: (token: string, ref: GithubRepoRef, sha: string) => Promise<ChecksView>
  updateBranch: (token: string, ref: GithubRepoRef, n: number, headSha: string) => Promise<{ ok: boolean; conflict: boolean; message?: string }>
  ready: (token: string, ref: GithubRepoRef, n: number) => Promise<{ ok: boolean; message?: string }>
  merge: typeof gatedMergePullRequest
  finalize: typeof finalizeFixMerge
  cursorKey: (db: SupabaseClient, projectId: string) => Promise<{ ok: true; apiKey: string; model: string | null } | { ok: false; reason: string }>
  createAgent: (apiKey: string, input: CreateCursorAgentV1Input) => Promise<{ agentId: string }>
  agentDone: (apiKey: string, agentId: string) => Promise<{ done: boolean; result: string | null }>
  requeueReview: typeof requeueReviewForNewHead
}

export interface AttemptRow {
  id: string
  project_id: string
  report_id: string | null
  agent: string | null
  branch: string | null
  commit_sha: string | null
  pr_url: string | null
  pr_number: number | null
  repo_id: string | null
  summary: string | null
}

async function event(db: SupabaseClient, row: QueueRow, status: 'ok' | 'fail' | 'pending', label: string, detail: string, dedupe: string) {
  const { error } = await db.from('fix_events').insert({
    fix_attempt_id: row.fix_attempt_id,
    project_id: row.project_id,
    kind: 'merge_queue',
    status,
    label,
    detail: detail.slice(0, 500),
    at: new Date().toISOString(),
    dedupe_key: dedupe,
    payload: { repo: row.repo, pr: row.pr_number },
  })
  if (error && (error as { code?: string }).code !== '23505') log.warn('merge-queue event not written', { rowId: row.id, err: error.message })
}

export async function processRow(db: SupabaseClient, row: QueueRow, deps: MergeQueueDeps): Promise<string> {
  const now = deps.now ?? (() => new Date())
  const set = async (patch: Record<string, unknown>) => {
    await db.from('fix_merge_queue').update({ ...patch, updated_at: now().toISOString(), claimed_until: null }).eq('id', row.id)
  }
  const { data: attemptData } = await db
    .from('fix_attempts')
    .select('id, project_id, report_id, agent, branch, commit_sha, pr_url, pr_number, repo_id, summary')
    .eq('id', row.fix_attempt_id)
    .maybeSingle()
  const attempt = attemptData as AttemptRow | null
  if (!attempt?.pr_url) {
    await set({ state: 'removed', detail: 'The fix has no pull request any more.' })
    return 'removed'
  }
  const [owner, repo] = row.repo.split('/')
  const ref: GithubRepoRef = { owner, repo }
  const token = await deps.token(db, attempt)
  if (!token) {
    await set({ state: 'blocked', detail: 'Mushi has no GitHub access to this repository.' })
    return 'blocked'
  }
  const pull = await deps.pull(token, ref, row.pr_number)
  if (!pull) {
    await set({ state: 'removed', detail: 'GitHub no longer finds this pull request.' })
    return 'removed'
  }
  const head = pull.headSha ?? null

  // A conflict agent is working: wait for its push, or give up after a while.
  if (row.state === 'resolving' && row.cursor_agent_id) {
    if (head && head !== row.agent_head_sha) {
      await set({ state: 'waiting', detail: 'The agent pushed a merge; checking it.', head_sha: head, cursor_agent_id: null })
      await event(db, row, 'ok', 'Conflict resolved by an agent', `New head ${head.slice(0, 7)}; the queue continues.`, `mq-resolved:${row.id}:${head}`)
      return 'resolved'
    }
    const key = await deps.cursorKey(db, row.project_id)
    const started = row.agent_started_at ? Date.parse(row.agent_started_at) : now().getTime()
    if (key.ok) {
      const status = await deps.agentDone(key.apiKey, row.cursor_agent_id).catch(() => ({ done: false, result: null }))
      if (status.done) {
        const why = status.result?.split('\n').find((l) => l.trim())?.slice(0, 300) ?? 'The agent finished without pushing a merge.'
        await set({ state: 'blocked', detail: `Merge conflict needs you: ${why}`, cursor_agent_id: null })
        return 'blocked'
      }
    }
    if (now().getTime() - started > CONFLICT_AGENT_TIMEOUT_MS) {
      await set({ state: 'blocked', detail: 'The conflict agent did not push within 90 minutes. Resolve it on GitHub.', cursor_agent_id: null })
      return 'blocked'
    }
    await set({})
    return 'resolving'
  }

  const checks = head ? await deps.checks(token, ref, head) : { pending: 0, failed: [] }
  const step = nextQueueStep(
    { state: pull.state, merged: pull.merged, draft: pull.draft, mergeable: pull.mergeable, mergeableState: pull.mergeableState, headSha: head },
    checks,
  )
  switch (step.do) {
    case 'done':
      await set({ state: 'merged', detail: 'Merged.', merged_at: pull.mergedAt ?? now().toISOString() })
      return 'merged'
    case 'drop':
      await set({ state: 'removed', detail: step.reason })
      return 'removed'
    case 'wait':
      await set({ state: 'waiting', detail: step.reason, head_sha: head })
      return 'waiting'
    case 'blocked':
      await set({ state: 'blocked', detail: step.reason, head_sha: head })
      if (row.state !== 'blocked') await event(db, row, 'fail', 'Merge queue: needs you', step.reason, `mq-blocked:${row.id}:${head}`)
      return 'blocked'
    case 'ready': {
      const r = await deps.ready(token, ref, row.pr_number)
      await set({ state: 'waiting', detail: r.ok ? 'Marked ready for review; checking again.' : `Could not mark it ready: ${r.message ?? 'GitHub refused'}`, head_sha: head })
      return 'waiting'
    }
    case 'update': {
      const r = await deps.updateBranch(token, ref, row.pr_number, head ?? '')
      if (r.ok) {
        await set({ state: 'waiting', detail: 'Updated with the base branch; waiting for CI on the new head.', head_sha: head })
        await event(db, row, 'pending', 'Merge queue: branch updated', 'The branch was behind; GitHub merged the base into it. CI runs on the new head.', `mq-update:${row.id}:${head}`)
        return 'updated'
      }
      if (!r.conflict) {
        await set({ state: 'blocked', detail: `GitHub did not update the branch: ${r.message ?? 'unknown error'}`, head_sha: head })
        return 'blocked'
      }
      return resolve(db, row, attempt, pull, head, deps, set, now)
    }
    case 'resolve':
      return resolve(db, row, attempt, pull, head, deps, set, now)
    case 'merge': {
      const outcome = await deps.merge(db, {
        projectId: row.project_id,
        token,
        ref,
        number: row.pr_number,
        fixAttemptId: row.fix_attempt_id,
        pull: { headSha: head, baseRepoId: pull.baseRepoId ?? null, baseRepoFullName: pull.baseRepoFullName ?? null },
        caller: 'service',
        reason: 'merge_queue',
        expectedHeadSha: head,
        override: false,
        overrideReason: null,
        confirmPendingReview: false,
        authMethod: 'service',
        role: null,
        merge: { mergeMethod: 'squash', commitTitle: attempt.summary ? `fix: ${attempt.summary.slice(0, 72)}` : undefined },
      })
      if (!outcome.ok) {
        // An updated branch has a new head, so its "merge" verdict is stale
        // until Opus reviews the new commit: ask for that review (the push
        // webhook does too) and wait for it.
        const review = outcome.review
        if (outcome.code === 'REVIEW_NOT_MERGE' && review?.verdict === 'merge' && (review.stale || review.rerunning)) {
          if (!review.rerunning) {
            await deps.requeueReview(
              db,
              { fixAttemptId: attempt.id, projectId: attempt.project_id, reportId: attempt.report_id, prUrl: attempt.pr_url },
              head,
              now(),
            )
          }
          await set({ state: 'waiting', detail: 'Opus is reviewing the updated commit; it merges when the verdict is merge.', head_sha: head })
          return 'waiting'
        }
        // A moved head or a first review still running is just another tick; a hold or a fix-first needs a person.
        const again = outcome.code === 'HEAD_MOVED' || outcome.code === 'REVIEW_PENDING'
        await set({ state: again ? 'waiting' : 'blocked', detail: outcome.message, head_sha: head })
        return again ? 'waiting' : 'blocked'
      }
      if (!outcome.result.merged) {
        await set({ state: 'waiting', detail: outcome.result.message ?? 'GitHub did not merge yet; trying again.', head_sha: head })
        return 'waiting'
      }
      await set({ state: 'merged', detail: 'Merged.', merged_at: now().toISOString(), head_sha: head })
      try {
        await deps.finalize(db as never, {
          id: attempt.id,
          project_id: attempt.project_id,
          report_id: attempt.report_id ?? '',
          agent: attempt.agent,
          branch: attempt.branch,
          commit_sha: head,
          pr_url: attempt.pr_url,
          pr_number: row.pr_number,
          merged_at: null,
        }, {
          prUrl: canonicalPrUrl(attempt.pr_url) ?? attempt.pr_url ?? '',
          prNumber: row.pr_number,
          repository: row.repo,
          actorUserId: row.queued_by,
          source: 'merge_queue',
        } as never)
      } catch (err) {
        log.warn('finalize after a queued merge failed', { rowId: row.id, err: err instanceof Error ? err.message : String(err) })
      }
      await event(db, row, 'ok', 'Merged from the queue', `Squash-merged ${head?.slice(0, 7) ?? ''} after CI passed.`, `mq-merged:${row.id}`)
      return 'merged'
    }
  }
}

async function resolve(
  db: SupabaseClient,
  row: QueueRow,
  attempt: AttemptRow,
  pull: PullRequestDetails,
  head: string | null,
  deps: MergeQueueDeps,
  set: (p: Record<string, unknown>) => Promise<void>,
  now: () => Date,
): Promise<string> {
  if (row.conflict_agents >= MAX_CONFLICT_AGENTS) {
    await set({ state: 'blocked', detail: `Merge conflict: ${MAX_CONFLICT_AGENTS} agent runs did not resolve it. Resolve it on GitHub.`, head_sha: head })
    return 'blocked'
  }
  const key = await deps.cursorKey(db, row.project_id)
  if (!key.ok) {
    await set({ state: 'blocked', detail: `Merge conflict. ${key.reason}`, head_sha: head })
    return 'blocked'
  }
  const prUrl = canonicalPrUrl(attempt.pr_url) ?? attempt.pr_url!
  const repoUrl = `https://github.com/${row.repo}`
  const agentId = await deterministicCursorAgentId(`merge-queue:${row.id}:${head ?? ''}`)
  try {
    await deps.createAgent(key.apiKey, {
      prompt: conflictPrompt({ prUrl, baseRef: pull.baseRef ?? 'main', headRef: pull.headRef ?? attempt.branch ?? 'the PR branch' }),
      repoUrl,
      prUrl,
      workOnCurrentBranch: true,
      autoCreatePR: false,
      agentId,
      name: `Mushi merge conflict #${row.pr_number}`,
      ...(key.model ? { model: key.model } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/agent_id_conflict|already exists/i.test(message)) {
      await set({ state: 'blocked', detail: `Merge conflict; Cursor did not start an agent: ${message.slice(0, 200)}`, head_sha: head })
      return 'blocked'
    }
  }
  await set({
    state: 'resolving',
    detail: 'Merge conflict: a Cursor agent is merging the base branch into the PR.',
    head_sha: head,
    cursor_agent_id: agentId,
    agent_started_at: now().toISOString(),
    agent_head_sha: head,
    conflict_agents: row.conflict_agents + 1,
  })
  await event(db, row, 'pending', 'Merge queue: conflict sent to an agent', 'A Cursor agent is merging the base branch into this PR and resolving the conflict.', `mq-conflict:${row.id}:${head}`)
  return 'resolving'
}

const IN_PROGRESS: Record<string, number> = { resolving: 0, waiting: 1, queued: 2, blocked: 3 }

/**
 * The PR a repo works on: the one already in progress (a conflict agent, or
 * CI on an updated branch), then the oldest queued. One console request
 * queues a whole app at the same instant, so `queued_at` alone ties and a
 * tick picked a different PR each time: four in CI at once (2026-10-23).
 */
export function queueOrder(a: { state: string; queued_at: string; pr_number: number }, b: { state: string; queued_at: string; pr_number: number }): number {
  return (IN_PROGRESS[a.state] ?? 9) - (IN_PROGRESS[b.state] ?? 9) || (a.queued_at ?? '').localeCompare(b.queued_at ?? '') || a.pr_number - b.pr_number
}

export async function runMergeQueue(db: SupabaseClient, deps: MergeQueueDeps, projectId?: string): Promise<Record<string, number>> {
  const now = deps.now ?? (() => new Date())
  const nowIso = now().toISOString()
  let q = db.from('fix_merge_queue').select(ROW_COLUMNS).in('state', ['queued', 'waiting', 'resolving', 'blocked'])
  if (projectId) q = q.eq('project_id', projectId)
  const { data, error } = await q.order('queued_at', { ascending: true }).limit(500)
  if (error) throw new Error(`merge-queue read failed: ${error.message}`)
  const all = (data ?? []) as Array<QueueRow & { claimed_until: string | null; queued_at: string }>
  // A row leased by a tick still running holds its repo.
  const repos = new Set<string>(all.filter((r) => r.claimed_until && r.claimed_until >= nowIso).map((r) => r.repo))
  const rows = all.filter((r) => !r.claimed_until || r.claimed_until < nowIso).sort(queueOrder)
  // One active row per repo, then some blocked re-checks.
  const picked: QueueRow[] = []
  for (const r of rows) {
    if (r.state === 'blocked' || repos.has(r.repo)) continue
    repos.add(r.repo)
    picked.push(r)
  }
  // A blocked row is looked at again only in a repo with nothing else moving,
  // so a re-check that updates its branch never puts a second PR into CI.
  for (const r of rows) {
    if (picked.length >= repos.size + BLOCKED_RECHECKS_PER_TICK) break
    if (r.state !== 'blocked' || repos.has(r.repo)) continue
    repos.add(r.repo)
    picked.push(r)
  }
  const tally: Record<string, number> = {}
  for (const row of picked) {
    const until = new Date(now().getTime() + LEASE_MS).toISOString()
    const { data: claimed } = await db
      .from('fix_merge_queue')
      .update({ claimed_until: until })
      .eq('id', row.id)
      .or(`claimed_until.is.null,claimed_until.lt.${nowIso}`)
      .select('id')
    if (!claimed || (claimed as unknown[]).length === 0) continue
    let outcome: string
    try {
      outcome = await processRow(db, row, deps)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('merge-queue row failed', { rowId: row.id, err: message })
      await db.from('fix_merge_queue').update({ claimed_until: null, detail: `Will retry: ${message.slice(0, 200)}` }).eq('id', row.id)
      outcome = 'error'
    }
    tally[outcome] = (tally[outcome] ?? 0) + 1
  }
  return tally
}
