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
}

/**
 * Express lane: a fix too urgent to wait for the window merges on its own,
 * as before ADR 0044 (a known hole in a dependency, or a critical bug).
 */
export function isExpress(c: Pick<TrainCandidate, 'severity' | 'source'>): boolean {
  return c.source === 'security_advisory' || (c.severity ?? '').toLowerCase() === 'critical'
}

/** Ready for a train: open, Opus says merge on its exact head, no hold. */
export function isTrainReady(c: TrainCandidate): boolean {
  return c.prOpen && !c.held && c.verdict === 'merge' && !!c.headSha && c.headSha === c.verdictHead
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
export function trainPullRequest(args: { members: TrainMemberLine[]; attempt: number; skipped: number; now: Date }): { title: string; body: string } {
  const n = args.members.length
  const date = args.now.toISOString().slice(0, 10)
  const clean = (t: string | null) => (t ?? '').replace(/\[[^\]]*\]/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120)
  const lines = args.members.map((m) => `- #${m.prNumber} ${clean(m.title) || '(no title)'}`)
  return {
    title: `release: ${n} fix${n === 1 ? '' : 'es'} (${date})${args.attempt > 1 ? ` · retry ${args.attempt}` : ''}`,
    body: [
      `Mushi release train: ${n} pull request${n === 1 ? '' : 's'} Opus approved, merged together so they ship as one deploy and one release (ADR 0044).`,
      '',
      ...lines,
      '',
      args.skipped ? `${args.skipped} more approved pull request${args.skipped === 1 ? '' : 's'} wait for the next train (conflict, or the batch was full).` : '',
      'Merging this PR with a merge commit marks every PR above as merged. Do not squash it.',
    ]
      .filter((l, i, a) => l !== '' || a[i - 1] !== '')
      .join('\n'),
  }
}
