/**
 * FILE: packages/server/supabase/functions/_shared/merge-train.ts
 * PURPOSE: Release trains (ADR 0044): batch an app's approved fix PRs into one
 *          branch, one pull request, one CI run and one merge, so a batch
 *          ships as one deploy, one OTA update and one changelog.
 *
 *          On 2026-10-23 the merge queue (ADR 0041) merged about 33 agent PRs
 *          one at a time: every merge was a push to main, and every push ran
 *          the app's CI, redeployed the site (tsumagoi 12×) and published an
 *          OTA update (glot.it 4×, lets-talk 5×), while each queued PR also got
 *          a branch update, a CI run and an Opus re-review before its merge.
 *
 *          Pattern: GitLab merge trains / GitHub merge queue merge groups,
 *          built by Mushi because the apps live in personal repos where
 *          GitHub's merge queue is not available. A red train is bisected:
 *          its first half goes again; a member that fails alone is held.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

export const RELEASE_MODES = ['train', 'each'] as const
export type ReleaseMode = (typeof RELEASE_MODES)[number]

export const TRAIN_STATES = ['building', 'testing', 'merged', 'failed', 'abandoned'] as const
export type TrainState = (typeof TRAIN_STATES)[number]

export const DEFAULT_TRAIN_INTERVAL_MINUTES = 360
export const DEFAULT_TRAIN_MAX_MEMBERS = 15

/**
 * CI on a candidate's own head. Only `green` rides (ADR 0044 amendment
 * 2026-10-26): on 2026-10-26, 37 of glot.it's 40 queued PRs were red on
 * their own heads, so every train failed, was bisected down to one member,
 * and the held member rode the next train again (179 red trains in 5 days).
 * `unknown` means it was not read (not approved on this head, or a draft).
 */
export type TrainCi = 'green' | 'pending' | 'red' | 'base_red' | 'unknown'

/**
 * A member that rode this many red trains at one head stops riding until it
 * has a new commit. One bisection of a full train (15 → 8 → 4 → 2 → 1) puts
 * an innocent member in at most 4, so 5 means it was in two bisections.
 */
export const MAX_RED_TRAINS_PER_HEAD = 5

/**
 * `release_trains.detail` of a train that failed on its members' code (not a
 * red base). Trains written before 2026-10-26 say "CI failed:" and are not
 * read back: the red-base check could not see through aggregators then, so
 * many of them failed only because the base branch was red.
 */
export const RED_TRAIN_DETAIL_PREFIX = 'Members failed CI:'

export interface TrainCandidate {
  rowId: string
  fixAttemptId: string
  prNumber: number
  queuedAt: string
  /** The PR's head now. */
  headSha: string | null
  /** The latest completed Opus verdict and the head it is about. */
  verdict: string | null
  verdictHead: string | null
  /** A hold on any review of this PR (also an older commit). */
  held: boolean
  prOpen: boolean
  /** reports.severity of the fix's report. */
  severity: string | null
  /** reports.source of the fix's report. */
  source: string | null
  /** A draft runs no CI until it is marked ready. */
  draft: boolean
  ci: TrainCi
  /** Why it may not ride at this head (red trains), or null. */
  benched: string | null
}

/**
 * Express lane: a fix too urgent to wait for the window merges on its own,
 * as before ADR 0044 (a known hole in a dependency, or a critical bug).
 */
export function isExpress(c: Pick<TrainCandidate, 'severity' | 'source'>): boolean {
  return c.source === 'security_advisory' || (c.severity ?? '').toLowerCase() === 'critical'
}

/** Opus says merge on its exact head and nothing holds it. */
export function isApprovedAtHead(c: TrainCandidate): boolean {
  return c.prOpen && !c.held && c.verdict === 'merge' && !!c.headSha && c.headSha === c.verdictHead
}

/** Ready for a train: approved at its head, not a draft, its own CI green, not benched. */
export function isTrainReady(c: TrainCandidate): boolean {
  return isApprovedAtHead(c) && !c.draft && c.ci === 'green' && !c.benched
}

export interface PastTrain {
  pr_number: number | null
  detail: string | null
  members: Array<{ rowId: string; headSha: string }>
}

/**
 * Why a member may not ride again at `headSha`, from the repo's recent red
 * trains (ADR 0044 amendment 2026-10-26): it failed alone at this head, or
 * it rode MAX_RED_TRAINS_PER_HEAD red trains at it. A new commit (a
 * CI-repair push, a branch update) clears both. Trains that failed because
 * the base branch was red are not counted.
 */
export function benchReason(history: PastTrain[], rowId: string, headSha: string | null): string | null {
  if (!headSha) return null
  const red = history.filter(
    (t) => (t.detail ?? '').startsWith(RED_TRAIN_DETAIL_PREFIX) && t.members.some((m) => m.rowId === rowId && m.headSha === headSha),
  )
  const alone = red.find((t) => t.members.length === 1)
  if (alone) {
    return `It failed CI alone in release train${alone.pr_number ? ` #${alone.pr_number}` : ''} at this commit (${(alone.detail ?? '').slice(RED_TRAIN_DETAIL_PREFIX.length).trim().replace(/\.$/, '')}). It rides again after a new commit; a CI-repair agent may push one.`
  }
  if (red.length >= MAX_RED_TRAINS_PER_HEAD) {
    return `It rode ${red.length} release trains that failed CI at this commit. It rides again after a new commit.`
  }
  return null
}

/** Members for the next train: ready, not express, oldest first, at most `max`. */
export function pickTrainMembers(candidates: TrainCandidate[], max = DEFAULT_TRAIN_MAX_MEMBERS): TrainCandidate[] {
  return candidates
    .filter((c) => isTrainReady(c) && !isExpress(c))
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.prNumber - b.prNumber)
    .slice(0, Math.max(1, max))
}

/**
 * Whether a new train may leave now. One train per repo at a time; after the
 * last one left, wait the interval, unless the batch is already full.
 */
export function trainDue(args: {
  activeTrain: boolean
  lastTrainAt: string | null
  now: Date
  intervalMinutes: number
  readyCount: number
  maxMembers: number
}): boolean {
  if (args.activeTrain || args.readyCount === 0) return false
  if (args.readyCount >= args.maxMembers) return true
  if (!args.lastTrainAt) return true
  return args.now.getTime() - Date.parse(args.lastTrainAt) >= args.intervalMinutes * 60_000
}

/**
 * A red train: retry its first half (bisect). A train of one is that
 * member's own failure: hold it, and the rest go on in the next train.
 */
export function bisectTrain<T>(members: T[]): { retry: T[]; deferred: T[]; failedAlone: T | null } {
  if (members.length <= 1) return { retry: [], deferred: [], failedAlone: members[0] ?? null }
  const half = Math.ceil(members.length / 2)
  return { retry: members.slice(0, half), deferred: members.slice(half), failedAlone: null }
}

/**
 * Re-runs of a red train's failed checks before it is judged (bisected, or its
 * only member blocked). A runner that could not install a browser (SBC #1299,
 * 2026-11-12) or a page scanned before it hydrated is not the members' code.
 */
export const TRAIN_CI_RERUNS = 1
/** `release_trains.detail` while a red train's failed checks run again. */
export const TRAIN_RERUN_DETAIL_PREFIX = 'Re-running the failed checks once:'

/** Whether a red train gets its failed checks re-run instead of being judged now. */
export function shouldRerunTrain(ciReruns: number | null | undefined): boolean {
  return (ciReruns ?? 0) < TRAIN_CI_RERUNS
}

/**
 * The GitHub Actions workflow runs behind a head's failed check runs, from each
 * check run's details URL (`…/actions/runs/<id>/job/<job>`). A check from
 * another CI (no Actions run in its URL) cannot be re-run this way and is left
 * out. At most 10, deduplicated.
 */
export function failedWorkflowRunIds(checkRuns: ReadonlyArray<{ conclusion?: string | null; details_url?: string | null }>): number[] {
  const ids = new Set<number>()
  for (const c of checkRuns) {
    if (c.conclusion !== 'failure' && c.conclusion !== 'timed_out') continue
    const m = /\/actions\/runs\/(\d+)(?:\/|$)/.exec(c.details_url ?? '')
    if (m) ids.add(Number(m[1]))
  }
  return [...ids].slice(0, 10)
}

/** `release_trains.detail` while GitHub refuses a train whose checks read clean. */
export const TRAIN_BLOCKED_DETAIL_PREFIX = 'GitHub blocks this train:'
/** How long GitHub may keep refusing before the train gives its place back. */
export const TRAIN_BLOCKED_GRACE_MS = 30 * 60_000

/**
 * Whether a train whose checks read clean may merge. Mushi's read of the checks
 * is not enough: a cancelled check is not a failed one, so a train whose CI was
 * cancelled looks green, and a token with admin rights merges past the required
 * checks where the repo does not enforce them for admins (2026-11-02). GitHub's
 * own merge state knows, so a train merges only when GitHub says it can.
 * A refused train waits for a re-run, then is abandoned, because a repo's queue
 * does nothing else while it has an active train.
 */
export function trainMergeGate(args: {
  mergeableState: string | null | undefined
  detail: string | null | undefined
  updatedAt: string | null | undefined
  now: Date
}): 'merge' | 'hold' | 'wait' | 'abandon' {
  const s = (args.mergeableState ?? 'unknown').toLowerCase()
  if (s === 'clean' || s === 'unstable' || s === 'has_hooks') return 'merge'
  if (s !== 'blocked') return 'wait'
  if (!(args.detail ?? '').startsWith(TRAIN_BLOCKED_DETAIL_PREFIX)) return 'hold'
  return args.now.getTime() - Date.parse(args.updatedAt ?? '') >= TRAIN_BLOCKED_GRACE_MS ? 'abandon' : 'wait'
}

/** `mushi/train/20261024-0130`, UTC. */
export function trainBranchName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `mushi/train/${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`
}

export interface TrainMemberLine {
  prNumber: number
  title: string | null
  reportId: string | null
}

/**
 * The train PR's title and body. Plain text only from the PR titles (agent
 * output): no links or markup is added from them, and no `[release…]` /
 * `[skip …]` marker can slip into the merge commit from a member title.
 */
export type TrainMergeMethod = 'merge' | 'squash'

export function trainPullRequest(args: { members: TrainMemberLine[]; attempt: number; skipped: number; now: Date; method?: TrainMergeMethod }): { title: string; body: string } {
  const n = args.members.length
  const date = args.now.toISOString().slice(0, 10)
  const clean = (t: string | null) => (t ?? '').replace(/\[[^\]]*\]/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120)
  const lines = args.members.map((m) => `- #${m.prNumber} ${clean(m.title) || '(no title)'}`)
  return {
    // A conventional-commit type the hosts' PR-title checks accept, and one
    // their release pipelines treat as a release (2026-10-24: yen-yen's check
    // rejected "release:", so every train there failed on its title).
    title: `fix: release train, ${n} fix${n === 1 ? '' : 'es'} (${date})${args.attempt > 1 ? `, retry ${args.attempt}` : ''}`,
    body: [
      `Mushi release train: ${n} pull request${n === 1 ? '' : 's'} Opus approved, merged together so they ship as one deploy and one release (ADR 0044).`,
      '',
      ...lines,
      '',
      args.skipped ? `${args.skipped} more approved pull request${args.skipped === 1 ? '' : 's'} wait for the next train (conflict, or the batch was full).` : '',
      args.method === 'squash'
        ? 'This repo keeps a linear history, so Mushi squash-merges this PR, then closes each PR above as shipped and marks its report fixed.'
        : 'Merging this PR with a merge commit marks every PR above as merged. Do not squash it.',
    ]
      .filter((l, i, a) => l !== '' || a[i - 1] !== '')
      .join('\n'),
  }
}
