// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
/**
 * merge-queue release trains (ADR 0044): one tick for one repo in `train`
 * mode. Batches the repo's approved fix PRs into one branch and one pull
 * request, waits for its CI, merges it through the review gate with a merge
 * commit (GitHub then marks every member PR merged), and bisects a red train.
 * Kept apart from worker.ts (single-PR merges) and from index.ts (live I/O)
 * so tests drive it with fake GitHub calls.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { GithubRepoRef, PullRequestDetails } from '../_shared/github.ts'
import type { finalizeFixMerge } from '../_shared/fix-merge.ts'
import type { gatedTrainMerge, TrainMember } from '../_shared/gated-merge.ts'
import type { requeueReviewForNewHead } from '../_shared/fix-review-db.ts'
import type { ChecksView } from '../_shared/merge-queue.ts'
import { log as rootLog } from '../_shared/logger.ts'
import {
  DEFAULT_TRAIN_INTERVAL_MINUTES,
  DEFAULT_TRAIN_MAX_MEMBERS,
  bisectTrain,
  isExpress,
  pickTrainMembers,
  trainBranchName,
  trainDue,
  trainPullRequest,
  type TrainCandidate,
} from '../_shared/merge-train.ts'

const log = rootLog.child('merge-train')

export interface TrainDeps {
  now?: () => Date
  pull: (token: string, ref: GithubRepoRef, n: number) => Promise<PullRequestDetails | null>
  checks: (token: string, ref: GithubRepoRef, sha: string) => Promise<ChecksView>
  updateBranch: (token: string, ref: GithubRepoRef, n: number, headSha: string) => Promise<{ ok: boolean; conflict: boolean; message?: string }>
  branchSha: (token: string, ref: GithubRepoRef, branch: string) => Promise<string | null>
  createBranch: (token: string, ref: GithubRepoRef, branch: string, sha: string) => Promise<boolean>
  /** Merge `head` (a commit) into `branch` server-side. 'conflict' when GitHub cannot. */
  mergeInto: (token: string, ref: GithubRepoRef, branch: string, head: string, message: string) => Promise<{ outcome: 'merged' | 'noop' | 'conflict' | 'error'; sha?: string; message?: string }>
  openPr: (token: string, ref: GithubRepoRef, pr: { head: string; base: string; title: string; body: string }) => Promise<{ number: number } | null>
  closePr: (token: string, ref: GithubRepoRef, n: number, comment: string) => Promise<void>
  deleteBranch: (token: string, ref: GithubRepoRef, branch: string) => Promise<void>
  trainMerge: typeof gatedTrainMerge
  finalize: typeof finalizeFixMerge
  requeueReview: typeof requeueReviewForNewHead
}

export interface TrainQueueRow {
  id: string
  fix_attempt_id: string
  project_id: string
  repo: string
  pr_number: number
  state: string
  queued_at: string
  queued_by: string | null
  train_id: string | null
}

interface TrainRow {
  id: string
  project_id: string
  repo: string
  branch: string
  base_ref: string
  pr_number: number | null
  head_sha: string | null
  state: string
  members: Array<TrainMember & { rowId: string }>
  attempt: number
  created_at: string
}

export interface TrainSettings {
  intervalMinutes: number
  maxMembers: number
}

export function trainSettingsFrom(row: { train_interval_minutes?: number | null; train_max_members?: number | null } | null): TrainSettings {
  return {
    intervalMinutes: row?.train_interval_minutes ?? DEFAULT_TRAIN_INTERVAL_MINUTES,
    maxMembers: row?.train_max_members ?? DEFAULT_TRAIN_MAX_MEMBERS,
  }
}

const TRAIN_COLUMNS = 'id, project_id, repo, branch, base_ref, pr_number, head_sha, state, members, attempt, created_at'

async function setRows(db: SupabaseClient, ids: string[], patch: Record<string, unknown>) {
  if (!ids.length) return
  await db.from('fix_merge_queue').update({ ...patch, updated_at: new Date().toISOString(), claimed_until: null }).in('id', ids)
}

async function trainEvent(db: SupabaseClient, rows: Array<{ fix_attempt_id: string; project_id: string; repo: string; pr_number: number }>, status: 'ok' | 'fail' | 'pending', label: string, detail: string, dedupe: string) {
  for (const r of rows) {
    const { error } = await db.from('fix_events').insert({
      fix_attempt_id: r.fix_attempt_id,
      project_id: r.project_id,
      kind: 'merge_queue',
      status,
      label,
      detail: detail.slice(0, 500),
      at: new Date().toISOString(),
      dedupe_key: `${dedupe}:${r.fix_attempt_id}`,
      payload: { repo: r.repo, pr: r.pr_number },
    })
    if (error && (error as { code?: string }).code !== '23505') log.warn('train event not written', { err: error.message })
  }
}

/** The train's members as queue rows (for events). */
function memberRows(train: TrainRow) {
  return train.members.map((m) => ({ fix_attempt_id: m.fixAttemptId, project_id: train.project_id, repo: train.repo, pr_number: m.prNumber }))
}

/**
 * Build and open a train from `members` (already picked). Members GitHub
 * cannot merge into the branch are left for the next train.
 */
async function buildTrain(
  db: SupabaseClient,
  args: { token: string; ref: GithubRepoRef; repo: string; projectId: string; baseRef: string; members: TrainCandidate[]; attempt: number; skippedBefore: number },
  deps: TrainDeps,
): Promise<string> {
  const now = (deps.now ?? (() => new Date()))()
  const baseSha = await deps.branchSha(args.token, args.ref, args.baseRef)
  if (!baseSha) return 'no_base'
  const branch = trainBranchName(now)
  if (!(await deps.createBranch(args.token, args.ref, branch, baseSha))) return 'branch_failed'
  const merged: TrainCandidate[] = []
  const conflicted: TrainCandidate[] = []
  let head = baseSha
  for (const m of args.members) {
    const r = await deps.mergeInto(args.token, args.ref, branch, m.headSha!, `Merge #${m.prNumber} into the release train`)
    if (r.outcome === 'merged' || r.outcome === 'noop') {
      merged.push(m)
      if (r.sha) head = r.sha
    } else conflicted.push(m)
  }
  if (conflicted.length) {
    await setRows(db, conflicted.map((c) => c.rowId), { state: 'queued', train_id: null, detail: 'Conflicts with the other fixes in this release train; it goes in a later one.' })
  }
  if (!merged.length) {
    await deps.deleteBranch(args.token, args.ref, branch)
    return 'all_conflicted'
  }
  const lines = await Promise.all(
    merged.map(async (m) => ({ prNumber: m.prNumber, title: (await deps.pull(args.token, args.ref, m.prNumber))?.title ?? null, reportId: null })),
  )
  const pr = trainPullRequest({ members: lines, attempt: args.attempt, skipped: args.skippedBefore + conflicted.length, now })
  const opened = await deps.openPr(args.token, args.ref, { head: branch, base: args.baseRef, title: pr.title, body: pr.body })
  if (!opened) {
    await deps.deleteBranch(args.token, args.ref, branch)
    return 'pr_failed'
  }
  const members = merged.map((m) => ({ rowId: m.rowId, fixAttemptId: m.fixAttemptId, prNumber: m.prNumber, headSha: m.headSha! }))
  const { data: train, error } = await db
    .from('release_trains')
    .insert({ project_id: args.projectId, repo: args.repo, branch, base_ref: args.baseRef, pr_number: opened.number, head_sha: head, state: 'testing', members, attempt: args.attempt, detail: `${merged.length} fixes; CI is running.` })
    .select('id')
    .maybeSingle()
  if (error || !train) {
    log.warn('release train row not written', { repo: args.repo, err: error?.message })
    return 'row_failed'
  }
  const trainId = (train as { id: string }).id
  await setRows(db, members.map((m) => m.rowId), { state: 'waiting', train_id: trainId, detail: `In release train #${opened.number} with ${merged.length - 1} other fix${merged.length === 2 ? '' : 'es'}; CI runs once for all of them.` })
  await trainEvent(db, memberRows({ ...(train as object), project_id: args.projectId, repo: args.repo, members } as TrainRow), 'pending', 'Release train started', `PR #${opened.number} carries ${merged.length} fixes; CI runs once.`, `train-start:${trainId}`)
  return 'started'
}

async function finishMerged(db: SupabaseClient, train: TrainRow, mergeSha: string | null, deps: TrainDeps) {
  const now = new Date().toISOString()
  await db.from('release_trains').update({ state: 'merged', merged_at: now, merge_sha: mergeSha, updated_at: now, detail: `Merged ${train.members.length} fixes.` }).eq('id', train.id)
  await setRows(db, train.members.map((m) => m.rowId), { state: 'merged', merged_at: now, detail: `Merged in release train #${train.pr_number}.` })
  const { data: attempts } = await db
    .from('fix_attempts')
    .select('id, project_id, report_id, agent, branch, commit_sha, pr_url, pr_number, merged_at')
    .in('id', train.members.map((m) => m.fixAttemptId))
  for (const a of (attempts ?? []) as Array<Record<string, unknown>>) {
    try {
      await deps.finalize(db as never, a as never, { prUrl: String(a.pr_url ?? ''), prNumber: a.pr_number as number, repository: train.repo, source: 'merge_queue' } as never)
    } catch (err) {
      log.warn('finalize after a train merge failed', { trainId: train.id, err: err instanceof Error ? err.message : String(err) })
    }
  }
  await trainEvent(db, memberRows(train), 'ok', 'Merged in a release train', `Release train #${train.pr_number} merged ${train.members.length} fixes as one release.`, `train-merged:${train.id}`)
}

/** One tick of the active train, if any. */
async function tickTrain(db: SupabaseClient, train: TrainRow, token: string, ref: GithubRepoRef, settings: TrainSettings, deps: TrainDeps): Promise<string> {
  const now = new Date().toISOString()
  const pr = train.pr_number ? await deps.pull(token, ref, train.pr_number) : null
  if (!pr) {
    await db.from('release_trains').update({ state: 'abandoned', updated_at: now, detail: 'The train PR is gone.' }).eq('id', train.id)
    await setRows(db, train.members.map((m) => m.rowId), { state: 'queued', train_id: null, detail: null })
    return 'abandoned'
  }
  if (pr.merged) {
    await finishMerged(db, train, null, deps)
    return 'merged'
  }
  if (pr.state && pr.state !== 'open') {
    await db.from('release_trains').update({ state: 'abandoned', updated_at: now, detail: 'The train PR was closed.' }).eq('id', train.id)
    await setRows(db, train.members.map((m) => m.rowId), { state: 'queued', train_id: null, detail: 'Its release train was closed; it goes in the next one.' })
    return 'abandoned'
  }
  // A member taken out of the queue (or closed) must not ride: rebuild without it.
  const { data: live } = await db.from('fix_merge_queue').select('id, state, train_id').in('id', train.members.map((m) => m.rowId))
  const riding = new Set(((live ?? []) as Array<{ id: string; state: string; train_id: string | null }>).filter((r) => r.train_id === train.id && r.state === 'waiting').map((r) => r.id))
  const left = train.members.filter((m) => !riding.has(m.rowId))
  if (left.length) {
    await deps.closePr(token, ref, train.pr_number!, `Rebuilding this train: ${left.map((m) => `#${m.prNumber}`).join(', ')} left the merge queue.`)
    await deps.deleteBranch(token, ref, train.branch)
    await db.from('release_trains').update({ state: 'abandoned', updated_at: now, detail: `${left.map((m) => `#${m.prNumber}`).join(', ')} left the queue.` }).eq('id', train.id)
    await setRows(db, train.members.filter((m) => riding.has(m.rowId)).map((m) => m.rowId), { state: 'queued', train_id: null, detail: null })
    return 'rebuild'
  }
  const head = pr.headSha ?? train.head_sha
  if ((pr.mergeableState ?? '').toLowerCase() === 'behind' && head) {
    const r = await deps.updateBranch(token, ref, train.pr_number!, head)
    await db.from('release_trains').update({ updated_at: now, detail: r.ok ? 'Updated with the base branch; CI runs again.' : `Could not update the train: ${r.message ?? 'GitHub refused'}` }).eq('id', train.id)
    return 'updated'
  }
  const checks = head ? await deps.checks(token, ref, head) : { pending: 1, failed: [] }
  if (checks.pending > 0 || pr.mergeable == null) {
    await db.from('release_trains').update({ updated_at: now, head_sha: head, detail: `CI is running for ${train.members.length} fixes (${checks.pending} check${checks.pending === 1 ? '' : 's'} left).` }).eq('id', train.id)
    return 'testing'
  }
  if (checks.failed.length) return redTrain(db, train, token, ref, checks.failed, settings, deps)
  const outcome = await deps.trainMerge(db, {
    projectId: train.project_id,
    token,
    ref,
    trainPr: train.pr_number!,
    trainHeadSha: head!,
    members: train.members.map(({ fixAttemptId, prNumber, headSha }) => ({ fixAttemptId, prNumber, headSha })),
    commitTitle: pr.title ?? undefined,
  })
  if (!outcome.ok) {
    if (outcome.code === 'REVIEW_UNAVAILABLE') return 'testing'
    // A member lost its approval (a new commit, a hold): rebuild without it.
    await deps.closePr(token, ref, train.pr_number!, `Rebuilding this train: ${outcome.refused.map((r) => `#${r.prNumber}`).join(', ')} no longer pass the review gate.`)
    await deps.deleteBranch(token, ref, train.branch)
    await db.from('release_trains').update({ state: 'abandoned', updated_at: now, detail: outcome.message }).eq('id', train.id)
    await setRows(db, train.members.map((m) => m.rowId), { state: 'queued', train_id: null, detail: null })
    return 'rebuild'
  }
  if (!outcome.result.merged) {
    await db.from('release_trains').update({ updated_at: now, detail: outcome.result.message ?? 'GitHub did not merge the train yet; trying again.' }).eq('id', train.id)
    return 'testing'
  }
  await finishMerged(db, train, outcome.result.sha ?? null, deps)
  return 'merged'
}

/** A red train: bisect, or hold the member that failed alone. */
async function redTrain(db: SupabaseClient, train: TrainRow, token: string, ref: GithubRepoRef, failed: string[], settings: TrainSettings, deps: TrainDeps): Promise<string> {
  const now = new Date().toISOString()
  const why = `CI failed: ${failed.slice(0, 4).join(', ')}.`
  await deps.closePr(token, ref, train.pr_number!, `${why} Mushi retries part of this train to find the pull request that breaks it.`)
  await deps.deleteBranch(token, ref, train.branch)
  await db.from('release_trains').update({ state: 'failed', updated_at: now, detail: why }).eq('id', train.id)
  const { retry, deferred, failedAlone } = bisectTrain(train.members)
  if (failedAlone) {
    await setRows(db, [failedAlone.rowId], { state: 'blocked', train_id: null, detail: `${why} It failed alone in a release train; a CI-repair agent may fix it.` })
    await trainEvent(db, [{ fix_attempt_id: failedAlone.fixAttemptId, project_id: train.project_id, repo: train.repo, pr_number: failedAlone.prNumber }], 'fail', 'Release train: this fix breaks CI', why, `train-alone:${train.id}`)
    return 'held'
  }
  await setRows(db, deferred.map((m) => m.rowId), { state: 'queued', train_id: null, detail: 'Its release train failed CI; it goes in a later one while Mushi finds the cause.' })
  const candidates: TrainCandidate[] = retry.map((m) => ({
    rowId: m.rowId,
    fixAttemptId: m.fixAttemptId,
    prNumber: m.prNumber,
    queuedAt: train.created_at,
    headSha: m.headSha,
    verdict: 'merge',
    verdictHead: m.headSha,
    held: false,
    prOpen: true,
    severity: null,
    source: null,
  }))
  return buildTrain(db, { token, ref, repo: train.repo, projectId: train.project_id, baseRef: train.base_ref, members: candidates, attempt: train.attempt + 1, skippedBefore: deferred.length }, deps)
}

/**
 * One tick for a repo in train mode. `rows` are its active queue rows (not
 * express). Returns what happened.
 */
export async function runTrainTick(
  db: SupabaseClient,
  args: { repo: string; projectId: string; token: string; rows: TrainQueueRow[]; settings: TrainSettings },
  deps: TrainDeps,
): Promise<string> {
  const now = (deps.now ?? (() => new Date()))()
  const [owner, name] = args.repo.split('/')
  const ref: GithubRepoRef = { owner, repo: name }
  const { data: active } = await db.from('release_trains').select(TRAIN_COLUMNS).eq('repo', args.repo).in('state', ['building', 'testing']).limit(1).maybeSingle()
  if (active) return tickTrain(db, active as TrainRow, args.token, ref, args.settings, deps)

  // Who could ride: each row's PR now, and its latest Opus verdict.
  const candidates: TrainCandidate[] = []
  let baseRef: string | null = null
  const ids = args.rows.map((r) => r.fix_attempt_id)
  const [{ data: reviews }, { data: attempts }] = await Promise.all([
    db.from('fix_reviews').select('fix_attempt_id, verdict, head_sha, status').in('fix_attempt_id', ids),
    db.from('fix_attempts').select('id, report_id').in('id', ids),
  ])
  const reportIds = ((attempts ?? []) as Array<{ id: string; report_id: string | null }>).map((a) => a.report_id).filter((x): x is string => !!x)
  const { data: reports } = reportIds.length ? await db.from('reports').select('id, severity, source').in('id', reportIds) : { data: [] }
  for (const r of args.rows) {
    const pull = await deps.pull(args.token, ref, r.pr_number)
    if (!pull) continue
    baseRef ??= pull.baseRef ?? null
    const rev = ((reviews ?? []) as Array<{ fix_attempt_id: string; verdict: string | null; head_sha: string | null; status: string }>).find((x) => x.fix_attempt_id === r.fix_attempt_id)
    const att = ((attempts ?? []) as Array<{ id: string; report_id: string | null }>).find((a) => a.id === r.fix_attempt_id)
    const rep = ((reports ?? []) as Array<{ id: string; severity: string | null; source: string | null }>).find((x) => x.id === att?.report_id)
    const c: TrainCandidate = {
      rowId: r.id,
      fixAttemptId: r.fix_attempt_id,
      prNumber: r.pr_number,
      queuedAt: r.queued_at,
      headSha: pull.headSha ?? null,
      verdict: rev?.verdict ?? null,
      verdictHead: rev?.head_sha ?? null,
      held: rev?.verdict === 'hold',
      prOpen: !pull.merged && (pull.state ?? 'open') === 'open',
      severity: rep?.severity ?? null,
      source: rep?.source ?? null,
    }
    if (pull.merged) {
      await setRows(db, [r.id], { state: 'merged', detail: 'Merged.', merged_at: now.toISOString() })
      continue
    }
    if (!c.prOpen) {
      await setRows(db, [r.id], { state: 'removed', detail: 'The pull request was closed without merging.' })
      continue
    }
    // An approved PR got a new commit: ask Opus to review the new head.
    if (c.verdict === 'merge' && c.headSha && c.verdictHead !== c.headSha && rev?.status !== 'queued' && rev?.status !== 'running') {
      const { data: a } = await db.from('fix_attempts').select('id, project_id, report_id, pr_url').eq('id', r.fix_attempt_id).maybeSingle()
      const at = a as { id: string; project_id: string; report_id: string; pr_url: string } | null
      if (at) await deps.requeueReview(db, { fixAttemptId: at.id, projectId: at.project_id, reportId: at.report_id, prUrl: at.pr_url }, c.headSha, now)
    }
    candidates.push(c)
  }
  const members = pickTrainMembers(candidates, args.settings.maxMembers)
  const { data: last } = await db.from('release_trains').select('created_at').eq('repo', args.repo).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const due = trainDue({
    activeTrain: false,
    lastTrainAt: (last as { created_at?: string } | null)?.created_at ?? null,
    now,
    intervalMinutes: args.settings.intervalMinutes,
    readyCount: candidates.filter((c) => members.some((m) => m.rowId === c.rowId)).length,
    maxMembers: args.settings.maxMembers,
  })
  const waiting = candidates.filter((c) => !members.some((m) => m.rowId === c.rowId) && !isExpress(c))
  if (waiting.length) {
    await setRows(db, waiting.map((w) => w.rowId), { detail: w0(waiting[0]) })
  }
  if (!due || !baseRef) {
    if (members.length) await setRows(db, members.map((m) => m.rowId), { state: 'queued', detail: 'Approved; waits for the next release train.' })
    return members.length ? 'waiting_for_window' : 'nothing_ready'
  }
  return buildTrain(db, { token: args.token, ref, repo: args.repo, projectId: args.projectId, baseRef, members, attempt: 1, skippedBefore: Math.max(0, candidates.filter((c) => c.verdict === 'merge').length - members.length) }, deps)
}

function w0(c: TrainCandidate): string {
  if (c.held) return 'Opus says hold on this commit. Open the fix to read why; only you can override a hold.'
  if (c.verdict === 'fix_first') return 'Opus says fix first; a follow-up agent works on its findings, then it can ride a release train.'
  if (c.verdict === 'merge' && c.verdictHead !== c.headSha) return 'Opus is reviewing the latest commit; it rides a release train once the verdict is merge.'
  if (!c.verdict) return 'Waiting for its Opus review before it can ride a release train.'
  return 'Waits for the next release train.'
}
