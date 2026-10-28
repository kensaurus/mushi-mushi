// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
/**
 * merge-queue release trains (ADR 0044): one tick for one repo in `train`
 * mode. Batches the repo's approved fix PRs into one branch and one pull
 * request, waits for its CI, merges it through the review gate with a merge
 * commit (GitHub then marks every member PR merged) or, where the repo keeps
 * a linear history, a squash (Mushi then closes each member as shipped), and
 * bisects a red train.
 * Kept apart from worker.ts (single-PR merges) and from index.ts (live I/O)
 * so tests drive it with fake GitHub calls.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { GithubRepoRef, PullRequestDetails } from '../_shared/github.ts'
import type { finalizeFixMerge } from '../_shared/fix-merge.ts'
import type { gatedTrainMerge, TrainMember } from '../_shared/gated-merge.ts'
import type { requeueReviewForNewHead } from '../_shared/fix-review-db.ts'
import { MAX_CONFLICT_AGENTS, checkNameList, failuresOnBase, type ChecksView } from '../_shared/merge-queue.ts'
import { FOLLOWUP_MAX_PER_PR } from '../_shared/review-followup.ts'
import { log as rootLog } from '../_shared/logger.ts'
import {
  DEFAULT_TRAIN_INTERVAL_MINUTES,
  DEFAULT_TRAIN_MAX_MEMBERS,
  RED_TRAIN_DETAIL_PREFIX,
  benchReason,
  bisectTrain,
  isApprovedAtHead,
  isExpress,
  isTrainReady,
  pickTrainMembers,
  trainBranchName,
  trainDue,
  trainPullRequest,
  type PastTrain,
  type TrainCandidate,
  type TrainCi,
  type TrainMergeMethod,
} from '../_shared/merge-train.ts'

const log = rootLog.child('merge-train')

/** Drafts marked ready per repo per tick: each one starts a CI run (ADR 0041: one PR per repo in CI). */
const DRAFTS_READIED_PER_TICK = 1
/** A conflicting PR blocked at its head is offered to a conflict agent again after this long. */
const CONFLICT_RECHECK_MS = 60 * 60_000
/** How far back red trains count against a member's head. */
const RED_TRAIN_HISTORY_MS = 7 * 24 * 60 * 60_000

export interface TrainDeps {
  now?: () => Date
  pull: (token: string, ref: GithubRepoRef, n: number) => Promise<PullRequestDetails | null>
  checks: (token: string, ref: GithubRepoRef, sha: string) => Promise<ChecksView>
  updateBranch: (token: string, ref: GithubRepoRef, n: number, headSha: string) => Promise<{ ok: boolean; conflict: boolean; message?: string }>
  /** Mark a draft PR ready for review, so its CI runs. */
  ready: (token: string, ref: GithubRepoRef, n: number) => Promise<{ ok: boolean; message?: string }>
  branchSha: (token: string, ref: GithubRepoRef, branch: string) => Promise<string | null>
  createBranch: (token: string, ref: GithubRepoRef, branch: string, sha: string) => Promise<boolean>
  /** Merge `head` (a commit) into `branch` server-side. 'conflict' when GitHub cannot. */
  mergeInto: (token: string, ref: GithubRepoRef, branch: string, head: string, message: string) => Promise<{ outcome: 'merged' | 'noop' | 'conflict' | 'error'; sha?: string; message?: string }>
  openPr: (token: string, ref: GithubRepoRef, pr: { head: string; base: string; title: string; body: string }) => Promise<{ number: number } | null>
  closePr: (token: string, ref: GithubRepoRef, n: number, comment: string) => Promise<void>
  deleteBranch: (token: string, ref: GithubRepoRef, branch: string) => Promise<void>
  /** 'squash' when the base branch must stay linear or merge commits are off; else 'merge'. */
  mergeMethod: (token: string, ref: GithubRepoRef, base: string) => Promise<TrainMergeMethod>
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
  /** Conflict agents already run on this PR (the single-PR path caps it). */
  conflict_agents?: number
  /** Why a blocked row is blocked, the head it was blocked at, and when that last changed. */
  detail?: string | null
  head_sha?: string | null
  updated_at?: string | null
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
  const method = await deps.mergeMethod(args.token, args.ref, args.baseRef)
  const pr = trainPullRequest({ members: lines, attempt: args.attempt, skipped: args.skippedBefore + conflicted.length, now, method })
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

async function finishMerged(db: SupabaseClient, train: TrainRow, mergeSha: string | null, deps: TrainDeps, squash?: { token: string; ref: GithubRepoRef }) {
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
  // A squash leaves the member PRs open: close each as shipped, after finalize
  // marked it merged (the closed-unmerged bookkeeping skips merged attempts).
  if (squash) {
    for (const m of train.members) {
      await deps.closePr(squash.token, squash.ref, m.prNumber, `Shipped in release train #${train.pr_number}${mergeSha ? ` (${mergeSha.slice(0, 7)})` : ''}: its commits are on the base branch.`)
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
  const method = await deps.mergeMethod(token, ref, train.base_ref)
  const outcome = await deps.trainMerge(db, {
    mergeMethod: method,
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
  await finishMerged(db, train, outcome.result.sha ?? null, deps, method === 'squash' ? { token, ref } : undefined)
  return 'merged'
}

/** A red train: bisect, or hold the member that failed alone. */
async function redTrain(db: SupabaseClient, train: TrainRow, token: string, ref: GithubRepoRef, failed: string[], settings: TrainSettings, deps: TrainDeps): Promise<string> {
  const now = new Date().toISOString()
  // Checks that fail on the base branch too are not the members' fault:
  // bisecting would split a healthy train and hold an innocent fix.
  const baseSha = await deps.branchSha(token, ref, train.base_ref)
  if (baseSha && failuresOnBase(failed, await deps.checks(token, ref, baseSha))) {
    const why = `${train.base_ref} is red too (${checkNameList(failed)}); the train waits for it to pass.`
    await deps.closePr(token, ref, train.pr_number!, `${why} No pull request in it is blamed; they ride the next train.`)
    await deps.deleteBranch(token, ref, train.branch)
    await db.from('release_trains').update({ state: 'failed', updated_at: now, detail: why }).eq('id', train.id)
    await setRows(db, train.members.map((m) => m.rowId), { state: 'queued', train_id: null, detail: why })
    await trainEvent(db, memberRows(train), 'pending', 'Release train waits for the base branch', why, `train-base-red:${train.id}`)
    return 'base_red'
  }
  const names = checkNameList(failed)
  const why = `CI failed: ${names}.`
  await deps.closePr(token, ref, train.pr_number!, `${why} Mushi retries part of this train to find the pull request that breaks it.`)
  await deps.deleteBranch(token, ref, train.branch)
  await db.from('release_trains').update({ state: 'failed', updated_at: now, detail: `${RED_TRAIN_DETAIL_PREFIX} ${names}.` }).eq('id', train.id)
  const { retry, deferred, failedAlone } = bisectTrain(train.members)
  if (failedAlone) {
    // Stays out of trains at this head (benchReason reads this train back).
    await setRows(db, [failedAlone.rowId], { state: 'blocked', train_id: null, head_sha: failedAlone.headSha, detail: `${why} It failed alone in a release train; a CI-repair agent may fix it.` })
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
    // Each was admitted green; the retry tests them together again.
    draft: false,
    ci: 'green',
    benched: null,
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
  /** Why an approved PR does not ride this time (ADR 0044 amendment 2026-10-26). */
  const notes = new Map<string, { state: 'queued' | 'blocked'; detail: string }>()
  let baseRef: string | null = null
  const ids = args.rows.map((r) => r.fix_attempt_id)
  const [{ data: reviews }, { data: attempts }, { data: past }] = await Promise.all([
    db.from('fix_reviews').select('fix_attempt_id, verdict, head_sha, status, completed_at, created_at').in('fix_attempt_id', ids),
    db.from('fix_attempts').select('id, report_id').in('id', ids),
    db.from('release_trains').select('pr_number, detail, members, created_at').eq('repo', args.repo).eq('state', 'failed').order('created_at', { ascending: false }).limit(200),
  ])
  const since = new Date(now.getTime() - RED_TRAIN_HISTORY_MS).toISOString()
  const history = ((past ?? []) as Array<PastTrain & { created_at: string }>).filter((t) => t.created_at >= since)
  const reportIds = ((attempts ?? []) as Array<{ id: string; report_id: string | null }>).map((a) => a.report_id).filter((x): x is string => !!x)
  const { data: reports } = reportIds.length ? await db.from('reports').select('id, severity, source').in('id', reportIds) : { data: [] }

  // The base branch's checks and the follow-up rounds used, read once and only when needed.
  let baseView: Promise<ChecksView | null> | null = null
  const baseChecks = (base: string) =>
    (baseView ??= (async () => {
      const sha = await deps.branchSha(args.token, ref, base)
      return sha ? await deps.checks(args.token, ref, sha) : null
    })())
  let rounds: Promise<Map<string, number>> | null = null
  const roundsUsed = async (fixAttemptId: string) => {
    rounds ??= (async () => {
      const { data } = await db.from('fix_review_followups').select('fix_attempt_id, cursor_agent_id').in('fix_attempt_id', ids)
      const m = new Map<string, number>()
      for (const f of (data ?? []) as Array<{ fix_attempt_id: string; cursor_agent_id: string | null }>) {
        if (f.cursor_agent_id) m.set(f.fix_attempt_id, (m.get(f.fix_attempt_id) ?? 0) + 1)
      }
      return m
    })()
    return (await rounds).get(fixAttemptId) ?? 0
  }
  /** CI on a head: only green rides; a red base is not the PR's fault; no runs while the base has some = not started. */
  const headCi = async (head: ChecksView, base: string | null): Promise<{ ci: TrainCi; failed: string[] }> => {
    if (head.pending > 0) return { ci: 'pending', failed: [] }
    const noRuns = head.failed.length === 0 && head.ran !== undefined && head.ran.length === 0
    if (!head.failed.length && !noRuns) return { ci: 'green', failed: [] }
    const b = base ? await baseChecks(base) : null
    if (noRuns) return { ci: b && (b.pending > 0 || b.failed.length > 0 || (b.ran?.length ?? 0) > 0) ? 'pending' : 'green', failed: [] }
    // A red base names only the checks that fail there; the rest are aggregators of them.
    if (b && failuresOnBase(head.failed, b)) return { ci: 'base_red', failed: head.failed.filter((n) => b.failed.includes(n)) }
    return { ci: 'red', failed: head.failed }
  }
  let readied = 0

  for (const r of args.rows) {
    const pull = await deps.pull(args.token, ref, r.pr_number)
    if (!pull) continue
    baseRef ??= pull.baseRef ?? null
    // The latest completed review decides; a queued or running one means a re-review is on its way.
    const mine = ((reviews ?? []) as Array<{ fix_attempt_id: string; verdict: string | null; head_sha: string | null; status: string; completed_at: string | null; created_at: string }>).filter((x) => x.fix_attempt_id === r.fix_attempt_id)
    const rev = mine.filter((x) => x.status === 'completed').sort((a, b) => (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at))[0]
    const reviewing = mine.some((x) => x.status === 'queued' || x.status === 'running')
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
      draft: !!pull.draft,
      ci: 'unknown',
      benched: null,
    }
    if (pull.merged) {
      await setRows(db, [r.id], { state: 'merged', detail: 'Merged.', merged_at: now.toISOString() })
      continue
    }
    if (!c.prOpen) {
      await setRows(db, [r.id], { state: 'removed', detail: 'The pull request was closed without merging.' })
      continue
    }
    // It conflicts with main itself, not with the other members: no train can
    // take it until a conflict agent merges main into it (the single-PR path,
    // at most MAX_CONFLICT_AGENTS runs per PR; past that it stays held).
    if ((pull.mergeableState ?? '').toLowerCase() === 'dirty' || pull.mergeable === false) {
      // A conflict agent could not start at this very head (follow-ups off, no
      // key, Cursor refused; resolve() wrote "Merge conflict…"): leave it for
      // an hour instead of sending it back to `resolving` every other tick.
      const blockedHere = r.state === 'blocked' && (r.detail ?? '').startsWith('Merge conflict') && !!r.head_sha &&
        r.head_sha === pull.headSha && now.getTime() - Date.parse(r.updated_at ?? '') < CONFLICT_RECHECK_MS
      if (blockedHere) continue
      if ((r.conflict_agents ?? 0) < MAX_CONFLICT_AGENTS) {
        await setRows(db, [r.id], { state: 'resolving', cursor_agent_id: null, detail: 'Conflicts with the base branch; a Cursor agent merges it in, then it rides a release train.' })
      } else if (r.state !== 'blocked') {
        await setRows(db, [r.id], { state: 'blocked', detail: `Merge conflict: ${MAX_CONFLICT_AGENTS} agent runs did not resolve it. Resolve it on GitHub.` })
      }
      continue
    }
    // An approved PR got a new commit: ask Opus to review the new head.
    if (c.verdict === 'merge' && c.headSha && c.verdictHead !== c.headSha && !reviewing) {
      const { data: a } = await db.from('fix_attempts').select('id, project_id, report_id, pr_url').eq('id', r.fix_attempt_id).maybeSingle()
      const at = a as { id: string; project_id: string; report_id: string; pr_url: string } | null
      if (at) await deps.requeueReview(db, { fixAttemptId: at.id, projectId: at.project_id, reportId: at.report_id, prUrl: at.pr_url }, c.headSha, now)
    }
    // Approved at its head: it rides only when its own CI is green, so one
    // red PR cannot sink a train, and a member a red train already found
    // guilty at this head does not ride again until it has a new commit.
    if (isApprovedAtHead(c)) {
      c.benched = benchReason(history, r.id, c.headSha)
      if (c.benched) {
        notes.set(r.id, { state: 'blocked', detail: c.benched })
      } else if (c.draft) {
        let detail = 'A draft runs no CI. Mushi marks one draft ready per tick; it rides a release train once its CI is green.'
        if (readied < DRAFTS_READIED_PER_TICK) {
          readied++
          const res = await deps.ready(args.token, ref, r.pr_number)
          detail = res.ok
            ? 'Marked ready for review so its CI runs; it rides a release train once CI is green.'
            : `A draft runs no CI, and Mushi could not mark it ready: ${(res.message ?? 'GitHub refused').slice(0, 200)}`
        }
        notes.set(r.id, { state: 'queued', detail })
      } else {
        const { ci, failed } = await headCi(await deps.checks(args.token, ref, c.headSha!), pull.baseRef ?? null)
        c.ci = ci
        const names = checkNameList(failed)
        if (ci === 'pending') {
          notes.set(r.id, { state: 'queued', detail: 'CI is running on its latest commit; it rides a release train once CI is green.' })
        } else if (ci === 'base_red') {
          const base = pull.baseRef ?? 'The base branch'
          notes.set(r.id, { state: 'queued', detail: `${base} is red too (${names}); it rides a release train once ${base} passes.` })
        } else if (ci === 'red') {
          notes.set(r.id, {
            state: 'blocked',
            detail: (await roundsUsed(r.fix_attempt_id)) >= FOLLOWUP_MAX_PER_PR
              ? `CI fails on its own commit (${names}) and both follow-up rounds are used. Fix it on GitHub; it rides a release train once its CI is green.`
              : `CI fails on its own commit (${names}). With review follow-ups on, a CI-repair agent fixes it; it rides a release train once its CI is green.`,
          })
        }
      }
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
    readyCount: members.length,
    maxMembers: args.settings.maxMembers,
  })
  // Each waiting PR says why it waits; rows with the same words are written together.
  const byNote = new Map<string, { patch: Record<string, unknown>; ids: string[] }>()
  for (const c of candidates) {
    if (members.some((m) => m.rowId === c.rowId) || isExpress(c)) continue
    const patch = notes.get(c.rowId) ?? { detail: w0(c) }
    const key = JSON.stringify(patch)
    byNote.set(key, { patch, ids: [...(byNote.get(key)?.ids ?? []), c.rowId] })
  }
  for (const { patch, ids: rowIds } of byNote.values()) await setRows(db, rowIds, patch)
  if (!due || !baseRef) {
    if (members.length) await setRows(db, members.map((m) => m.rowId), { state: 'queued', detail: 'Approved; waits for the next release train.' })
    return members.length ? 'waiting_for_window' : 'nothing_ready'
  }
  return buildTrain(db, { token: args.token, ref, repo: args.repo, projectId: args.projectId, baseRef, members, attempt: 1, skippedBefore: Math.max(0, candidates.filter(isTrainReady).length - members.length) }, deps)
}

function w0(c: TrainCandidate): string {
  if (c.held) return 'The AI review says do not merge this commit. Open the fix to read why; only you can override it.'
  if (c.verdict === 'fix_first') return 'Opus says fix first; a follow-up agent works on its findings, then it can ride a release train.'
  if (c.verdict === 'merge' && c.verdictHead !== c.headSha) return 'The AI review is checking the latest commit; it rides a release train once the verdict is merge.'
  if (!c.verdict) return 'Waiting for its Opus review before it can ride a release train.'
  return 'Waits for the next release train.'
}
