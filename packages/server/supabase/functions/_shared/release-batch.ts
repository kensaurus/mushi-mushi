/**
 * FILE: packages/server/supabase/functions/_shared/release-batch.ts
 * PURPOSE: The release batch view (console ops plan 2026-10-27, P1 "See it";
 *          /releases "Batch" tab): for each repo, the release train that is
 *          open now or leaves next (ADR 0044), in one place:
 *
 *            - its members, each with Opus's verdict at its current commit
 *              and that commit's CI;
 *            - the train's CI and the ADR 0044 rules (amendment 2026-10-26)
 *              each member must pass to ride;
 *            - migration files in the members' changes, matched against the
 *              app recipe's migrations folder (ADR 0016, read-only context);
 *            - whether a deploy was seen after the last train merged.
 *
 *          Read-only. Mushi never applies a host app's migrations; it lists
 *          them so the owner knows a deploy needs one.
 *
 *          Who rides is decided by the merge-queue worker's own predicates
 *          (merge-train.ts: isApprovedAtHead, isTrainReady, isExpress,
 *          benchReason, pickTrainMembers, trainDue), so the tab says what the
 *          next tick will do. The worker reads CI live from GitHub and checks
 *          the base branch; this view reads CI from the stored jobs, so a
 *          failing check reads "failing" without saying whose fault it is.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

import {
  benchReason,
  DEFAULT_TRAIN_INTERVAL_MINUTES,
  DEFAULT_TRAIN_MAX_MEMBERS,
  isApprovedAtHead,
  isExpress,
  pickTrainMembers,
  trainDue,
  type PastTrain,
  type TrainCandidate,
  type TrainCi,
} from './merge-train.ts'
import { matchAny } from './recipe-glob.ts'

const DAY = 24 * 3600_000

/** Used when the app has no recipe or its recipe names no migrations folder. */
export const DEFAULT_MIGRATION_GLOBS = ['supabase/migrations/**', 'prisma/migrations/**', 'migrations/**'] as const

/** Red trains older than this do not bench a member (the worker's RED_TRAIN_HISTORY_MS). */
export const RED_HISTORY_MS = 7 * DAY

/** The setup gap a missing deploy points to (the Set up page). */
export const DEPLOY_GAP_HREF = '/onboarding#setup-gaps'

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface BatchSettings {
  mode: 'train' | 'each'
  intervalMinutes: number
  maxMembers: number
}

export function batchSettingsFrom(row: { release_mode?: string | null; train_interval_minutes?: number | null; train_max_members?: number | null } | null): BatchSettings {
  return {
    mode: row?.release_mode === 'each' ? 'each' : 'train',
    intervalMinutes: row?.train_interval_minutes ?? DEFAULT_TRAIN_INTERVAL_MINUTES,
    maxMembers: row?.train_max_members ?? DEFAULT_TRAIN_MAX_MEMBERS,
  }
}

export interface BatchTrainRow {
  id: string
  repo: string
  pr_number: number | null
  state: string
  members: unknown
  attempt: number | null
  detail: string | null
  head_sha: string | null
  merge_sha: string | null
  created_at: string
  merged_at: string | null
}

export interface BatchQueueRow {
  id: string
  fix_attempt_id: string
  repo: string
  pr_number: number
  state: string
  detail: string | null
  queued_at: string
  train_id: string | null
}

export interface BatchAttempt {
  id: string
  prUrl: string | null
  prState: string | null
  /** The PR's head as Mushi last saw it. */
  headSha: string | null
  checkRunConclusion: string | null
  title: string | null
  severity: string | null
  source: string | null
}

export interface BatchReview {
  fix_attempt_id: string
  verdict: string | null
  head_sha: string | null
  status: string
  completed_at: string | null
  created_at: string
}

/** CI on one commit from the stored jobs (review-followup ciHeadState's states). */
export interface HeadCi {
  state: 'code_failure' | 'base_failing' | 'pending' | 'infra' | 'green' | 'none'
  failing: string[]
}

export interface MemberFiles {
  files: Array<{ filename: string; previousFilename?: string | null }>
  /** False when GitHub had more pages than were read. */
  complete: boolean
}

export interface DeployObservation {
  observed_at: string
  observed_commit: string | null
  observed_version: string | null
  ok: boolean | null
}

export interface RepoBatchInput {
  now: Date
  projectId: string
  projectName: string
  repo: string
  settings: BatchSettings
  /** This repo's trains of the last 7 days, any state. */
  trains: BatchTrainRow[]
  /** This repo's merge-queue rows (queued, waiting, resolving, blocked). */
  queue: BatchQueueRow[]
  attempts: Map<string, BatchAttempt>
  reviews: BatchReview[]
  /** CI per commit; a commit missing here has no stored jobs. */
  ciByHead: Map<string, HeadCi>
  /** Recipe `data.migrationsDir`, when the app has a recipe that names one. */
  migrationsDir: string | null
  /** Changed files per fix attempt; null = could not be read; missing = not read. */
  files: Map<string, MemberFiles | null>
  /** This project's deploy events of the last 14 days. */
  deploys: DeployObservation[]
}

// ── Output ──────────────────────────────────────────────────────────────────

export type MemberCi = 'green' | 'pending' | 'failing' | 'base_failing' | 'machine' | 'none' | 'unknown'

export interface BatchMember {
  fixAttemptId: string
  prNumber: number
  prUrl: string | null
  title: string | null
  headSha: string | null
  verdict: string | null
  /** Opus's latest verdict is about this exact commit. */
  verdictAtHead: boolean
  ci: MemberCi
  ciFailing: string[]
  draft: boolean
  express: boolean
  benched: string | null
  /** Riding the open train, or picked for the next one. */
  rides: boolean
  /** Why it rides or waits, in plain words. */
  why: string
  /** The merge queue's own last note on this row. */
  queueDetail: string | null
}

export interface BatchGate {
  id: 'approved_at_head' | 'not_draft' | 'ci_green' | 'not_benched' | 'not_urgent'
  label: string
  passed: number
  total: number
}

export interface MigrationFile {
  prNumber: number
  path: string
}

export interface RepoBatch {
  projectId: string
  projectName: string
  repo: string
  mode: 'train' | 'each'
  train: {
    kind: 'open' | 'next'
    prNumber: number | null
    state: string | null
    attempt: number
    detail: string | null
    createdAt: string | null
    ci: MemberCi
    ciFailing: string[]
    /** When the next train may leave; null while one is open or nothing is ready. */
    leavesAt: string | null
    readyCount: number
    maxMembers: number
    intervalMinutes: number
  }
  members: BatchMember[]
  gates: BatchGate[]
  migrations: {
    source: 'recipe' | 'default'
    globs: string[]
    files: MigrationFile[]
    /** False when a member's file list was cut off or could not be read. */
    complete: boolean
    unread: number[]
  }
  deploy: {
    state: 'live' | 'deployed_since_merge' | 'not_seen' | 'no_merge'
    train: { prNumber: number | null; mergedAt: string; mergeSha: string | null } | null
    seenAt: string | null
    version: string | null
    /** Set when no deploy at all was seen in 14 days: the setup gap explains why. */
    setupGapHref: string | null
  }
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/** Members as release_trains stores them: [{ rowId, fixAttemptId, prNumber, headSha }]. */
export function trainMembers(raw: unknown): Array<{ rowId: string; fixAttemptId: string; prNumber: number; headSha: string | null }> {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((m) => {
    if (!m || typeof m !== 'object') return []
    const o = m as Record<string, unknown>
    if (typeof o.fixAttemptId !== 'string' || typeof o.prNumber !== 'number') return []
    return [{ rowId: typeof o.rowId === 'string' ? o.rowId : '', fixAttemptId: o.fixAttemptId, prNumber: o.prNumber, headSha: typeof o.headSha === 'string' ? o.headSha : null }]
  })
}

/** The globs that count as migrations: the recipe's folder, else the common ones. */
export function migrationGlobs(migrationsDir: string | null): { source: 'recipe' | 'default'; globs: string[] } {
  const dir = (migrationsDir ?? '').trim().replace(/^\.\//, '').replace(/\/+$/, '')
  if (dir && !dir.startsWith('/') && !dir.split('/').includes('..')) return { source: 'recipe', globs: [`${dir}/**`] }
  return { source: 'default', globs: [...DEFAULT_MIGRATION_GLOBS] }
}

/** Reads `data.migrationsDir` from a recipe manifest of any shape. */
export function recipeMigrationsDir(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== 'object') return null
  const data = (manifest as Record<string, unknown>).data
  if (!data || typeof data !== 'object') return null
  const dir = (data as Record<string, unknown>).migrationsDir
  return typeof dir === 'string' && dir.trim() ? dir.trim() : null
}

/** A member's migration files; a renamed file counts by either name. */
export function migrationFilesOf(files: MemberFiles['files'], globs: readonly string[]): string[] {
  const out: string[] = []
  for (const f of files) {
    if (matchAny(f.filename, globs) || (f.previousFilename && matchAny(f.previousFilename, globs))) out.push(f.filename)
  }
  return out
}

/** Stored CI for a head, as the train rules see it; the PR's check summary when no jobs were stored. */
export function memberCi(head: string | null, ciByHead: Map<string, HeadCi>, checkRunConclusion: string | null): { ci: MemberCi; failing: string[] } {
  const stored = head ? ciByHead.get(head) : undefined
  if (stored && stored.state !== 'none') {
    switch (stored.state) {
      case 'green':
        return { ci: 'green', failing: [] }
      case 'pending':
        return { ci: 'pending', failing: [] }
      case 'code_failure':
        return { ci: 'failing', failing: stored.failing }
      case 'base_failing':
        return { ci: 'base_failing', failing: stored.failing }
      case 'infra':
        return { ci: 'machine', failing: [] }
    }
  }
  const c = (checkRunConclusion ?? '').toLowerCase()
  if (c === 'success' || c === 'neutral' || c === 'skipped') return { ci: 'green', failing: [] }
  if (c === 'failure' || c === 'timed_out' || c === 'cancelled' || c === 'action_required') return { ci: 'failing', failing: [] }
  if (!head) return { ci: 'unknown', failing: [] }
  return { ci: 'none', failing: [] }
}

/** The worker's TrainCi for a member: only a stored green rides; failing is not split into own/base here. */
function trainCiOf(ci: MemberCi): TrainCi {
  if (ci === 'green') return 'green'
  if (ci === 'pending' || ci === 'none') return 'pending'
  if (ci === 'base_failing') return 'base_red'
  if (ci === 'failing') return 'red'
  return 'unknown'
}

/** The latest completed review decides; a queued or running one is on its way. */
function latestReview(reviews: BatchReview[], fixAttemptId: string): BatchReview | null {
  return (
    reviews
      .filter((r) => r.fix_attempt_id === fixAttemptId && r.status === 'completed')
      .sort((a, b) => (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at))[0] ?? null
  )
}

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : '')

function sameCommit(a: string | null, b: string | null): boolean {
  if (!a || !b || a.length < 7 || b.length < 7) return false
  const [x, y] = [a.toLowerCase(), b.toLowerCase()]
  return x.startsWith(y) || y.startsWith(x)
}

/**
 * Deploy after the last merged train: the merge commit running somewhere
 * (`live`), or a deploy seen after the merge (`deployed_since_merge`; a
 * squash merge changes the sha, so this one is matched by time).
 */
export function deployAfterMerge(trains: BatchTrainRow[], deploys: DeployObservation[], now: Date): RepoBatch['deploy'] {
  const merged = trains.filter((t) => t.state === 'merged' && t.merged_at).sort((a, b) => (b.merged_at ?? '').localeCompare(a.merged_at ?? ''))[0]
  const anyRecent = deploys.some((d) => now.getTime() - Date.parse(d.observed_at) <= 14 * DAY)
  const setupGapHref = anyRecent ? null : DEPLOY_GAP_HREF
  if (!merged || !merged.merged_at) return { state: 'no_merge', train: null, seenAt: null, version: null, setupGapHref }
  const train = { prNumber: merged.pr_number, mergedAt: merged.merged_at, mergeSha: merged.merge_sha }
  const after = deploys.filter((d) => d.observed_at >= merged.merged_at! && d.ok !== false).sort((a, b) => a.observed_at.localeCompare(b.observed_at))
  const exact = after.find((d) => sameCommit(d.observed_commit, merged.merge_sha))
  if (exact) return { state: 'live', train, seenAt: exact.observed_at, version: exact.observed_version, setupGapHref }
  const first = after[0]
  if (first) return { state: 'deployed_since_merge', train, seenAt: first.observed_at, version: first.observed_version, setupGapHref }
  return { state: 'not_seen', train, seenAt: null, version: null, setupGapHref }
}

function whyText(c: TrainCandidate, ci: MemberCi, failing: string[], mode: BatchSettings['mode'], picked: boolean, riding: boolean): string {
  if (riding) return 'Riding this train.'
  if (mode === 'each') return 'This app merges each fix on its own (release mode "each"), not in trains.'
  if (!c.prOpen) return 'Its pull request is closed.'
  if (c.held) return 'Opus said hold. It does not ride until a person decides.'
  if (c.verdict !== 'merge') return c.verdict ? `Opus said ${c.verdict.replace(/_/g, ' ')}. It rides once Opus says merge.` : 'Waiting for the Opus review.'
  if (c.verdictHead !== c.headSha) return `Opus approved an older commit (${short(c.verdictHead)}); it is reviewed again at ${short(c.headSha)} first.`
  if (isExpress(c)) return 'Urgent (a security advisory or a critical bug): it merges on its own, without waiting for a train.'
  if (c.draft) return 'A draft runs no CI. Mushi marks it ready; it rides once its CI is green.'
  if (c.benched) return c.benched
  if (ci === 'pending') return 'CI is running on its latest commit.'
  if (ci === 'none') return 'Mushi has no CI result stored for its latest commit; the merge queue asks GitHub when it builds the train.'
  if (ci === 'base_failing') return `The base branch fails the same checks (${failing.slice(0, 3).join(', ')}); it rides once the base passes.`
  if (ci === 'failing') return `CI is failing on its latest commit${failing.length ? ` (${failing.slice(0, 3).join(', ')})` : ''}.`
  if (ci === 'machine') return 'The test machine stopped; CI runs again.'
  if (ci === 'unknown') return 'Mushi has no CI result for its latest commit yet.'
  return picked ? 'Ready: it rides the next train.' : 'Ready, but the next train is full; it rides the one after.'
}

// ── The view ────────────────────────────────────────────────────────────────

export function buildRepoBatch(input: RepoBatchInput): RepoBatch {
  const { now, settings } = input
  const sorted = [...input.trains].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const open = sorted.find((t) => t.state === 'building' || t.state === 'testing') ?? null
  const history: PastTrain[] = sorted
    .filter((t) => t.state === 'failed' && now.getTime() - Date.parse(t.created_at) <= RED_HISTORY_MS)
    .map((t) => ({ pr_number: t.pr_number, detail: t.detail, members: trainMembers(t.members).map((m) => ({ rowId: m.rowId, headSha: m.headSha ?? '' })) }))
  const queueByAttempt = new Map(input.queue.map((q) => [q.fix_attempt_id, q]))
  const openMembers = open ? trainMembers(open.members) : []
  const riding = new Set(openMembers.map((m) => m.fixAttemptId))

  // Candidates: the open train's members, then every queued row not in it.
  const rows: Array<{ fixAttemptId: string; rowId: string; prNumber: number; queuedAt: string; trainHead: string | null }> = [
    ...openMembers.map((m) => ({ fixAttemptId: m.fixAttemptId, rowId: m.rowId, prNumber: m.prNumber, queuedAt: queueByAttempt.get(m.fixAttemptId)?.queued_at ?? '', trainHead: m.headSha })),
    ...input.queue
      .filter((q) => !riding.has(q.fix_attempt_id))
      .map((q) => ({ fixAttemptId: q.fix_attempt_id, rowId: q.id, prNumber: q.pr_number, queuedAt: q.queued_at, trainHead: null })),
  ]

  const built = rows.map((r) => {
    const a = input.attempts.get(r.fixAttemptId)
    const head = r.trainHead ?? a?.headSha ?? null
    const rev = latestReview(input.reviews, r.fixAttemptId)
    const { ci, failing } = memberCi(head, input.ciByHead, a?.checkRunConclusion ?? null)
    const c: TrainCandidate = {
      rowId: r.rowId,
      fixAttemptId: r.fixAttemptId,
      prNumber: r.prNumber,
      queuedAt: r.queuedAt,
      headSha: head,
      verdict: rev?.verdict ?? null,
      verdictHead: rev?.head_sha ?? null,
      held: rev?.verdict === 'hold',
      prOpen: a ? a.prState !== 'closed' && a.prState !== 'merged' : true,
      severity: a?.severity ?? null,
      source: a?.source ?? null,
      draft: a?.prState === 'draft',
      ci: trainCiOf(ci),
      benched: null,
    }
    if (isApprovedAtHead(c)) c.benched = benchReason(history, r.rowId, head)
    return { c, a, ci, failing }
  })

  const waiting = built.filter((b) => !riding.has(b.c.fixAttemptId))
  const picked = settings.mode === 'train' && !open ? new Set(pickTrainMembers(waiting.map((b) => b.c), settings.maxMembers).map((c) => c.fixAttemptId)) : new Set<string>()
  const ready = settings.mode === 'train' ? waiting.filter((b) => pickTrainMembers([b.c], 1).length === 1).length : 0
  const lastTrainAt = sorted[0]?.created_at ?? null
  const due = settings.mode === 'train' && !open
    ? trainDue({ activeTrain: false, lastTrainAt, now, intervalMinutes: settings.intervalMinutes, readyCount: ready, maxMembers: settings.maxMembers })
    : false
  const leavesAt = settings.mode !== 'train' || open || ready === 0
    ? null
    : due || !lastTrainAt
      ? now.toISOString()
      : new Date(Date.parse(lastTrainAt) + settings.intervalMinutes * 60_000).toISOString()

  const members: BatchMember[] = built.map(({ c, a, ci, failing }) => {
    const isRiding = riding.has(c.fixAttemptId)
    const isPicked = picked.has(c.fixAttemptId)
    return {
      fixAttemptId: c.fixAttemptId,
      prNumber: c.prNumber,
      prUrl: a?.prUrl ?? null,
      title: a?.title ?? null,
      headSha: c.headSha,
      verdict: c.verdict,
      verdictAtHead: !!c.headSha && c.verdictHead === c.headSha,
      ci,
      ciFailing: failing,
      draft: c.draft,
      express: isExpress(c),
      benched: c.benched,
      rides: isRiding || isPicked,
      why: whyText(c, ci, failing, settings.mode, isPicked, isRiding),
      queueDetail: queueByAttempt.get(c.fixAttemptId)?.detail ?? null,
    }
  })
  // Riding and picked first, then the rest by how long they have waited.
  const order = new Map(built.map((b, i) => [b.c.fixAttemptId, i]))
  members.sort((x, y) => Number(y.rides) - Number(x.rides) || (order.get(x.fixAttemptId) ?? 0) - (order.get(y.fixAttemptId) ?? 0))

  const cs = built.map((b) => b.c)
  const gates: BatchGate[] = [
    { id: 'approved_at_head', label: 'Opus said merge at its current commit, and nothing holds it', passed: cs.filter(isApprovedAtHead).length, total: cs.length },
    { id: 'not_draft', label: 'Not a draft (a draft runs no CI)', passed: cs.filter((c) => !c.draft).length, total: cs.length },
    { id: 'ci_green', label: 'Its own CI is green', passed: cs.filter((c) => c.ci === 'green').length, total: cs.length },
    { id: 'not_benched', label: 'Not benched: it did not fail alone, or ride 5 red trains, at this commit', passed: cs.filter((c) => !c.benched).length, total: cs.length },
    { id: 'not_urgent', label: 'Not urgent (an urgent fix merges on its own)', passed: cs.filter((c) => !isExpress(c)).length, total: cs.length },
  ]

  // Migrations: in every listed member's change.
  const { source, globs } = migrationGlobs(input.migrationsDir)
  const migrationFiles: MigrationFile[] = []
  const unread: number[] = []
  let complete = true
  for (const m of members) {
    const f = input.files.get(m.fixAttemptId)
    if (!f) {
      unread.push(m.prNumber)
      complete = false
      continue
    }
    if (!f.complete) complete = false
    for (const path of migrationFilesOf(f.files, globs)) migrationFiles.push({ prNumber: m.prNumber, path })
  }

  const trainCi = open?.head_sha ? memberCi(open.head_sha, input.ciByHead, null) : { ci: 'unknown' as MemberCi, failing: [] }
  return {
    projectId: input.projectId,
    projectName: input.projectName,
    repo: input.repo,
    mode: settings.mode,
    train: {
      kind: open ? 'open' : 'next',
      prNumber: open?.pr_number ?? null,
      state: open?.state ?? null,
      attempt: open?.attempt ?? 1,
      detail: open?.detail ?? null,
      createdAt: open?.created_at ?? null,
      ci: open ? trainCi.ci : 'unknown',
      ciFailing: open ? trainCi.failing : [],
      leavesAt,
      readyCount: open ? openMembers.length : ready,
      maxMembers: settings.maxMembers,
      intervalMinutes: settings.intervalMinutes,
    },
    members,
    gates,
    migrations: { source, globs, files: migrationFiles, complete, unread },
    deploy: deployAfterMerge(input.trains, input.deploys, now),
  }
}
