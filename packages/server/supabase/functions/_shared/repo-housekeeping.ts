/**
 * FILE: packages/server/supabase/functions/_shared/repo-housekeeping.ts
 * PURPOSE: Which branches and pull requests a repo clean-up may touch (ADR
 *          0051, console ops plan P4). Pure: the routes read the database and
 *          GitHub, this file decides.
 *
 * Branches. Only a branch Mushi itself recorded (fix_attempts, release_trains,
 * ux_runs, sdk_upgrade_jobs, ci_cost_fix_jobs), never one picked by its name.
 * It is a candidate when all of these hold:
 *   - its pull request (the recorded number, head = this branch in this repo)
 *     is merged or closed;
 *   - the branch still points at that pull request's last commit (nothing was
 *     pushed after it closed);
 *   - it is not the default branch, not protected, not the head or the base
 *     of any open pull request;
 *   - no Mushi row on it is still running (an agent about to push);
 *   - it is not already in a clean-up waiting for a decision.
 *
 * Pull requests. Only open PRs of Mushi's fix attempts (they have a report to
 * keep the reason on, and an Opus review). A candidate when any of:
 *   - superseded: a newer attempt for the same report has an open or merged PR;
 *   - hold: the latest Opus review said hold about the PR's current head
 *     (a hold about an older head is stale and does not count);
 *   - stale: its head commit is older than `staleDays`.
 *   Never one riding a release train or the head of a running Mushi row.
 *
 * The item each preview lists carries the commit it was decided on; the
 * approval covers that exact list, and the run refuses an item whose commit
 * moved (repo-housekeeping-run.ts).
 *
 * No imports: vitest loads this file directly.
 */

/** At most this many items in one clean-up action. */
export const MAX_HOUSEKEEPING_ITEMS = 50
/** At most this many clean-up actions an hour per app (asked, and run). */
export const HOUSEKEEPING_ACTIONS_PER_HOUR = 5
export const DEFAULT_STALE_DAYS = 14
export const MIN_STALE_DAYS = 7
export const MAX_STALE_DAYS = 90

export const SHA_RE = /^[0-9a-f]{40}$/
/** owner/name, as GitHub allows them. */
export const REPO_FULL_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
/** A branch name Mushi will put in a URL path or a ref: git's rules, minus anything odd. */
export const BRANCH_RE = /^(?!\/)(?!.*\/\/)(?!.*\.\.)(?!.*@\{)(?!.*\/$)(?!.*\.lock$)[A-Za-z0-9._/+-]{1,255}$/

export type RecordedSource = 'fix_attempt' | 'release_train' | 'ux_run' | 'sdk_upgrade' | 'ci_cost_fix'

export interface RecordedBranch {
  source: RecordedSource
  sourceId: string
  /** owner/name, lower case. */
  repo: string
  branch: string
  prNumber: number | null
  /** The row is still working (an agent or job may push to this branch). */
  active: boolean
}

export interface GhBranch {
  name: string
  sha: string
  protected: boolean
}

export interface GhPull {
  number: number
  state: 'open' | 'closed'
  merged: boolean
  draft: boolean
  headRef: string
  /** owner/name of the head repository, lower case; null when the fork is gone. */
  headRepo: string | null
  headSha: string
  baseRef: string
  closedAt: string | null
  mergedAt: string | null
}

export interface FixAttemptPr {
  id: string
  reportId: string | null
  repo: string
  prNumber: number
  createdAt: string
  /** pending / running: the agent may still push. */
  active: boolean
  merged: boolean
}

export interface ReviewRow {
  fixAttemptId: string
  verdict: string | null
  headSha: string | null
  summary: string | null
  at: string
}

export interface RepoFacts {
  repo: string
  defaultBranch: string
  /** Every branch GitHub listed, with its tip. */
  branches: GhBranch[]
  /** Every open pull request (all heads, Mushi's or not). */
  openPulls: GhPull[]
  /** Closed pull requests by number, for the recorded ones. */
  closedPulls: Map<number, GhPull>
  /** Head commit date of each open PR, by number (null when not read). */
  headCommitAt: Map<number, string | null>
  /** The listing stopped at its page cap: some branches may be missing. */
  truncated: boolean
}

export interface BranchCandidate {
  key: string
  branch: string
  headSha: string
  prNumber: number
  prState: 'merged' | 'closed'
  closedAt: string | null
  sources: Array<{ source: RecordedSource; id: string }>
  reason: string
}

export interface PrCandidate {
  key: string
  prNumber: number
  headSha: string
  branch: string
  fixAttemptId: string
  reportId: string | null
  why: Array<'superseded' | 'hold' | 'stale'>
  reason: string
  draft: boolean
}

export interface KeptItem {
  key: string
  reason: string
}

export const branchKey = (branch: string) => `branch:${branch}`
export const prKey = (n: number) => `pr:${n}`
export const SETTING_KEY = 'setting:delete_branch_on_merge'

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'an unknown date')

/** Repo-qualified head check: a fork's PR with the same branch name is not this branch's PR. */
export function isHeadOf(pull: GhPull, repo: string, branch: string): boolean {
  return pull.headRef === branch && (pull.headRepo ?? '').toLowerCase() === repo.toLowerCase()
}

/**
 * Why this branch may not be deleted now, or null. The same rules run at
 * preview and again at execute, on fresh reads.
 */
export function branchRefusal(
  input: { repo: string; branch: string; defaultBranch: string; protectedBranch: boolean; openPulls: GhPull[] },
): string | null {
  const { repo, branch } = input
  if (branch === input.defaultBranch) return 'It is the default branch.'
  if (input.protectedBranch) return 'It is a protected branch.'
  const head = input.openPulls.find((p) => isHeadOf(p, repo, branch))
  if (head) return `It is the head of open pull request #${head.number}.`
  const base = input.openPulls.find((p) => p.baseRef === branch)
  if (base) return `Open pull request #${base.number} targets it; deleting it would close that pull request.`
  return null
}

export function branchCandidates(
  facts: RepoFacts,
  recorded: RecordedBranch[],
  pending: Set<string>,
): { candidates: BranchCandidate[]; kept: KeptItem[]; gone: number } {
  const repo = facts.repo.toLowerCase()
  const tips = new Map(facts.branches.map((b) => [b.name, b]))
  const byBranch = new Map<string, RecordedBranch[]>()
  for (const r of recorded) {
    if (r.repo.toLowerCase() !== repo || !BRANCH_RE.test(r.branch)) continue
    byBranch.set(r.branch, [...(byBranch.get(r.branch) ?? []), r])
  }
  const candidates: BranchCandidate[] = []
  const kept: KeptItem[] = []
  let gone = 0
  for (const [branch, rows] of [...byBranch.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const key = branchKey(branch)
    const tip = tips.get(branch)
    if (!tip) {
      gone++
      continue
    }
    const refused = branchRefusal({ repo, branch, defaultBranch: facts.defaultBranch, protectedBranch: tip.protected, openPulls: facts.openPulls })
    if (refused) {
      kept.push({ key, reason: refused })
      continue
    }
    if (rows.some((r) => r.active)) {
      kept.push({ key, reason: 'A Mushi run on this branch is still going.' })
      continue
    }
    if (pending.has(key)) {
      kept.push({ key, reason: 'Already in a clean-up waiting for a decision.' })
      continue
    }
    // The newest recorded PR whose head is this branch and that GitHub reports closed.
    const numbers = [...new Set(rows.map((r) => r.prNumber).filter((n): n is number => typeof n === 'number' && n > 0))].sort((a, b) => b - a)
    const pull = numbers.map((n) => facts.closedPulls.get(n)).find((p): p is GhPull => !!p && isHeadOf(p, repo, branch))
    if (!pull) {
      kept.push({ key, reason: numbers.length ? 'Its pull request is not closed on GitHub, or Mushi could not read it.' : 'Mushi recorded no pull request for it.' })
      continue
    }
    if (pull.headSha !== tip.sha) {
      kept.push({ key, reason: `It has commits pushed after pull request #${pull.number} closed.` })
      continue
    }
    candidates.push({
      key,
      branch,
      headSha: tip.sha,
      prNumber: pull.number,
      prState: pull.merged ? 'merged' : 'closed',
      closedAt: pull.mergedAt ?? pull.closedAt,
      sources: rows.map((r) => ({ source: r.source, id: r.sourceId })),
      reason: pull.merged
        ? `Pull request #${pull.number} was merged on ${day(pull.mergedAt)}; the branch still points at its last commit.`
        : `Pull request #${pull.number} was closed without merging on ${day(pull.closedAt)}; the branch still points at its last commit.`,
    })
  }
  return { candidates, kept, gone }
}

export function prCandidates(
  facts: RepoFacts,
  attempts: FixAttemptPr[],
  reviews: ReviewRow[],
  opts: { staleDays: number; now: Date; riding: Set<number>; pending: Set<string>; activeBranches: Set<string> },
): { candidates: PrCandidate[]; kept: KeptItem[] } {
  const repo = facts.repo.toLowerCase()
  const open = new Map(facts.openPulls.map((p) => [p.number, p]))
  const mine = attempts.filter((a) => a.repo.toLowerCase() === repo)
  const latestReview = new Map<string, ReviewRow>()
  for (const r of reviews) {
    const cur = latestReview.get(r.fixAttemptId)
    if (!cur || Date.parse(r.at) > Date.parse(cur.at)) latestReview.set(r.fixAttemptId, r)
  }
  const staleBefore = opts.now.getTime() - opts.staleDays * 24 * 3600_000
  const candidates: PrCandidate[] = []
  const kept: KeptItem[] = []
  const seen = new Set<number>()
  for (const a of [...mine].sort((x, y) => x.prNumber - y.prNumber)) {
    const pull = open.get(a.prNumber)
    if (!pull || seen.has(a.prNumber)) continue
    seen.add(a.prNumber)
    if (!isHeadOf(pull, repo, pull.headRef)) continue
    const key = prKey(a.prNumber)
    if (a.active || opts.activeBranches.has(pull.headRef)) {
      kept.push({ key, reason: 'A Mushi run on this pull request is still going.' })
      continue
    }
    if (opts.riding.has(a.prNumber)) {
      kept.push({ key, reason: 'It is riding a release train.' })
      continue
    }
    if (opts.pending.has(key)) {
      kept.push({ key, reason: 'Already in a clean-up waiting for a decision.' })
      continue
    }
    const why: PrCandidate['why'] = []
    const words: string[] = []
    const newer = mine
      .filter((b) => b.id !== a.id && a.reportId && b.reportId === a.reportId && Date.parse(b.createdAt) > Date.parse(a.createdAt) && b.prNumber !== a.prNumber && (b.merged || open.has(b.prNumber)))
      .sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt))[0]
    if (newer) {
      why.push('superseded')
      words.push(`a newer fix for the same report is ${newer.merged ? 'merged' : 'open'} as #${newer.prNumber}`)
    }
    const review = latestReview.get(a.id)
    if (review?.verdict === 'hold' && review.headSha && review.headSha === pull.headSha) {
      why.push('hold')
      words.push(`the Opus review said hold about this commit${review.summary ? ` (${review.summary.slice(0, 160)})` : ''}`)
    }
    const at = facts.headCommitAt.get(a.prNumber) ?? null
    if (at && Date.parse(at) < staleBefore) {
      why.push('stale')
      words.push(`nothing was pushed since ${day(at)}`)
    }
    if (why.length === 0) continue
    candidates.push({
      key,
      prNumber: a.prNumber,
      headSha: pull.headSha,
      branch: pull.headRef,
      fixAttemptId: a.id,
      reportId: a.reportId,
      why,
      draft: pull.draft,
      reason: `Close #${a.prNumber}: ${words.join('; ')}.`,
    })
  }
  return { candidates, kept }
}

// ─────────────────────────────────────────────────────────────────────────────
// Payloads: what an approval covers. Built by the server from a fresh preview
// (never from the client), checked again before anything runs.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeleteBranchesPayload {
  repo: string
  defaultBranch: string
  items: Array<{ key: string; branch: string; headSha: string; prNumber: number; prState: 'merged' | 'closed'; reason: string }>
}

export interface ClosePrsPayload {
  repo: string
  staleDays: number
  items: Array<{ key: string; prNumber: number; headSha: string; branch: string; fixAttemptId: string; reason: string }>
}

export interface SettingPayload {
  repo: string
  setting: 'delete_branch_on_merge'
  value: true
  expected: false
}

export interface RestorePayload {
  repo: string
  restoreOf: string
  items: Array<{ key: string; itemId: string; branch: string; sha: string }>
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** The reason a stored payload cannot run, or null. Defence in depth: the routes build these. */
export function housekeepingPayloadProblem(action: string, payload: unknown): string | null {
  if (!isObj(payload) || typeof payload.repo !== 'string' || !REPO_FULL_RE.test(payload.repo)) return 'The payload names no repository.'
  if (action === 'set_delete_branch_on_merge') {
    return payload.setting === 'delete_branch_on_merge' && payload.value === true ? null : 'Mushi only turns on "Automatically delete head branches".'
  }
  const items = payload.items
  if (!Array.isArray(items) || items.length === 0) return 'The payload has no items.'
  if (items.length > MAX_HOUSEKEEPING_ITEMS) return `At most ${MAX_HOUSEKEEPING_ITEMS} items in one clean-up.`
  const keys = new Set<string>()
  for (const it of items) {
    if (!isObj(it) || typeof it.key !== 'string' || keys.has(it.key)) return 'The payload has a broken or repeated item.'
    keys.add(it.key)
    if (action === 'delete_branches') {
      if (typeof it.branch !== 'string' || !BRANCH_RE.test(it.branch) || typeof it.headSha !== 'string' || !SHA_RE.test(it.headSha)) return 'A branch item has no valid name or commit.'
      if (it.branch === payload.defaultBranch) return 'The default branch is never deleted.'
    } else if (action === 'close_prs') {
      if (typeof it.prNumber !== 'number' || !(it.prNumber > 0) || typeof it.headSha !== 'string' || !SHA_RE.test(it.headSha) || typeof it.fixAttemptId !== 'string') return 'A pull request item has no valid number, head or fix.'
    } else if (action === 'restore_branches') {
      if (typeof it.branch !== 'string' || !BRANCH_RE.test(it.branch) || typeof it.sha !== 'string' || !SHA_RE.test(it.sha) || typeof it.itemId !== 'string') return 'A restore item has no valid branch or commit.'
    } else {
      return `Unknown clean-up action "${action}".`
    }
  }
  return null
}

export function clampStaleDays(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(n)) return DEFAULT_STALE_DAYS
  return Math.min(MAX_STALE_DAYS, Math.max(MIN_STALE_DAYS, Math.round(n)))
}
