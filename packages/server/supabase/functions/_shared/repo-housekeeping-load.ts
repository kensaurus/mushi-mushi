/**
 * FILE: packages/server/supabase/functions/_shared/repo-housekeeping-load.ts
 * PURPOSE: Database and GitHub reads for the repo clean-up (ADR 0051): what
 *          Mushi recorded for a project, and the preview built from it and
 *          from fresh GitHub lists. The run (repo-housekeeping-run.ts) reads
 *          the same rows again before it changes anything.
 *
 * A failed read never becomes "nothing to clean": it throws, and the route
 * answers an error. A table that is not there yet (ci_cost_fix_jobs on an
 * older database) counts as no rows.
 */

import type { getServiceClient } from './db.ts'
import { parseGithubRepoUrl } from './github.ts'
import { isHousekeepingAction, HOUSEKEEPING_ACTIONS } from './repo-housekeeping-acts.ts'
import {
  branchCandidates,
  prCandidates,
  type BranchCandidate,
  type FixAttemptPr,
  type GhPull,
  type KeptItem,
  type PrCandidate,
  type RecordedBranch,
  type RepoFacts,
  type ReviewRow,
} from './repo-housekeeping.ts'
import { ghClient, headCommitDates, listBranches, listPulls, readPull, readRepo, type FetchLike } from './repo-housekeeping-github.ts'

type Db = ReturnType<typeof getServiceClient>

const PAGE = 1000
const MAX_ROWS = 10_000
/** Closed PRs read per repo by list, then one by one for recorded numbers the list missed. */
const CLOSED_PAGES = 5
const CLOSED_SINGLE_READS = 20
const OPEN_PAGES = 5
/** GitHub API calls left below which the preview stops (other Mushi work shares the token's quota). */
export const PREVIEW_GITHUB_FLOOR = 300
export const NO_TOKEN =
  'No GitHub token is stored for this app. Store a fine-grained token with "Contents: Read and write" and "Pull requests: Read and write" on the repository in the app’s GitHub settings (add "Administration: Read and write" to turn on automatic branch deletion). The Mushi GitHub App is not used for clean-up.'
/** Kept items returned per repo (the rest are counted). */
const KEPT_SHOWN = 100

/** Fix statuses after which the agent no longer pushes. Anything else counts as running. */
const FIX_TERMINAL = new Set(['completed', 'failed', 'skipped_no_context', 'cancelled', 'canceled', 'no_change', 'superseded'])

export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204') return true
  return /does not exist|could not find the table|schema cache/i.test(error.message ?? '')
}

export function repoFromPrUrl(prUrl: string | null | undefined): string | null {
  if (!prUrl) return null
  const ref = parseGithubRepoUrl(prUrl.split('/pull/')[0])
  return ref ? `${ref.owner}/${ref.repo}`.toLowerCase() : null
}

function prNumberOf(prUrl: string | null | undefined, n: number | null | undefined): number | null {
  if (typeof n === 'number' && n > 0) return n
  const m = /\/pull\/(\d+)/.exec(prUrl ?? '')
  return m ? Number(m[1]) : null
}

async function readAll<T>(db: Db, table: string, columns: string, projectId: string, opts: { optional?: boolean; orderBy?: string } = {}): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).eq('project_id', projectId).order(opts.orderBy ?? 'created_at', { ascending: false }).range(from, from + PAGE - 1)
    if (error) {
      if (opts.optional && isMissingTable(error)) return []
      throw new Error(`${table} read failed: ${error.message}`)
    }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export interface Recorded {
  branches: RecordedBranch[]
  attempts: FixAttemptPr[]
  /** Branch names a running Mushi row may still push to (any repo of the project). */
  activeBranches: Set<string>
}

/** Everything Mushi recorded for the project's branches and fix PRs. */
export async function loadRecorded(db: Db, projectId: string): Promise<Recorded> {
  type Fix = { id: string; report_id: string | null; status: string | null; branch: string | null; branch_name: string | null; pr_url: string | null; pr_number: number | null; pr_state: string | null; merged_at: string | null; created_at: string }
  type Train = { id: string; repo: string | null; branch: string | null; pr_number: number | null; state: string | null }
  type Run = { id: string; branch: string | null; pr_url: string | null; pr_number: number | null; status: string | null }
  type Cost = { id: string; repo: string | null; branch: string | null; pr_number: number | null; status: string | null }
  const [fixes, trains, uxRuns, upgrades, costs] = await Promise.all([
    readAll<Fix>(db, 'fix_attempts', 'id, report_id, status, branch, branch_name, pr_url, pr_number, pr_state, merged_at, created_at', projectId),
    readAll<Train>(db, 'release_trains', 'id, repo, branch, pr_number, state', projectId),
    readAll<Run>(db, 'ux_runs', 'id, branch, pr_url, pr_number, status', projectId, { optional: true, orderBy: 'started_at' }),
    readAll<Run>(db, 'sdk_upgrade_jobs', 'id, branch, pr_url, pr_number, status', projectId, { optional: true }),
    readAll<Cost>(db, 'ci_cost_fix_jobs', 'id, repo, branch, pr_number, status', projectId, { optional: true }),
  ])
  // A fix whose attempt finished can still get pushes: a cloud review follow-up
  // (ADR 0032) or a merge-queue conflict agent (ADR 0041) working on its PR.
  const busy = new Set<string>()
  const followups = await db.from('fix_review_followups').select('fix_attempt_id, status').eq('project_id', projectId).in('status', ['queued', 'dispatched', 'running'])
  if (followups.error && !isMissingTable(followups.error)) throw new Error(`fix_review_followups read failed: ${followups.error.message}`)
  for (const r of (followups.data ?? []) as Array<{ fix_attempt_id: string | null }>) if (r.fix_attempt_id) busy.add(r.fix_attempt_id)
  const conflicts = await db.from('fix_merge_queue').select('fix_attempt_id, state').eq('project_id', projectId).eq('state', 'resolving')
  if (conflicts.error) throw new Error(`fix_merge_queue read failed: ${conflicts.error.message}`)
  for (const r of (conflicts.data ?? []) as Array<{ fix_attempt_id: string | null }>) if (r.fix_attempt_id) busy.add(r.fix_attempt_id)

  const branches: RecordedBranch[] = []
  const attempts: FixAttemptPr[] = []
  const activeBranches = new Set<string>()
  const add =(source: RecordedBranch['source'], id: string, repo: string | null, branch: string | null, pr: number | null, active: boolean) => {
    if (!branch) return
    if (active) activeBranches.add(branch)
    if (repo) branches.push({ source, sourceId: id, repo: repo.toLowerCase(), branch, prNumber: pr, active })
  }
  for (const f of fixes) {
    const active = !FIX_TERMINAL.has((f.status ?? '').toLowerCase()) || busy.has(f.id)
    const repo = repoFromPrUrl(f.pr_url)
    const pr = prNumberOf(f.pr_url, f.pr_number)
    for (const b of new Set([f.branch, f.branch_name].filter((x): x is string => !!x))) add('fix_attempt', f.id, repo, b, pr, active)
    if (repo && pr) {
      const merged = !!f.merged_at || (f.pr_state ?? '').toLowerCase() === 'merged'
      attempts.push({ id: f.id, reportId: f.report_id, repo, prNumber: pr, createdAt: f.created_at, active, merged })
    }
  }
  for (const t of trains) add('release_train', t.id, t.repo, t.branch, t.pr_number, t.state === 'building' || t.state === 'testing')
  for (const r of uxRuns) add('ux_run', r.id, repoFromPrUrl(r.pr_url), r.branch, prNumberOf(r.pr_url, r.pr_number), r.status === 'running')
  for (const r of upgrades) add('sdk_upgrade', r.id, repoFromPrUrl(r.pr_url), r.branch, prNumberOf(r.pr_url, r.pr_number), r.status === 'queued' || r.status === 'running')
  for (const r of costs) add('ci_cost_fix', r.id, r.repo, r.branch, r.pr_number, r.status === 'queued' || r.status === 'running')
  return { branches, attempts, activeBranches }
}

/** Latest Opus reviews of the given fixes. */
export async function loadReviews(db: Db, projectId: string, fixIds: string[]): Promise<ReviewRow[]> {
  const out: ReviewRow[] = []
  for (let i = 0; i < fixIds.length; i += 100) {
    const { data, error } = await db
      .from('fix_reviews')
      .select('fix_attempt_id, verdict, head_sha, summary, reviewed_at, created_at')
      .eq('project_id', projectId)
      .in('fix_attempt_id', fixIds.slice(i, i + 100))
    if (error) throw new Error(`fix_reviews read failed: ${error.message}`)
    for (const r of (data ?? []) as Array<{ fix_attempt_id: string; verdict: string | null; head_sha: string | null; summary: string | null; reviewed_at: string | null; created_at: string }>) {
      out.push({ fixAttemptId: r.fix_attempt_id, verdict: r.verdict, headSha: r.head_sha, summary: r.summary, at: r.reviewed_at ?? r.created_at })
    }
  }
  return out
}

/** PR numbers riding (or queued for) a release train, by repo. */
export async function loadRiding(db: Db, projectId: string): Promise<Map<string, Set<number>>> {
  const { data, error } = await db.from('fix_merge_queue').select('repo, pr_number, state, train_id').eq('project_id', projectId).not('train_id', 'is', null)
  if (error) throw new Error(`fix_merge_queue read failed: ${error.message}`)
  const out = new Map<string, Set<number>>()
  for (const r of (data ?? []) as Array<{ repo: string | null; pr_number: number | null; state: string }>) {
    if (!r.repo || !r.pr_number || r.state === 'merged' || r.state === 'removed') continue
    const k = r.repo.toLowerCase()
    out.set(k, new Set([...(out.get(k) ?? []), r.pr_number]))
  }
  return out
}

export interface HousekeepingActionRow {
  id: string
  organization_id: string
  project_id: string | null
  action: string
  payload: Record<string, unknown>
  payload_sha256: string
  reason: string | null
  status: string
  requested_by: string
  requested_at: string
  approved_by: string | null
  approved_at: string | null
  expires_at: string | null
  executed_at: string | null
  result: Record<string, unknown> | null
  error: string | null
  connector_kind?: string | null
}

export const ACTION_COLUMNS = 'id, organization_id, project_id, action, payload, payload_sha256, reason, status, requested_by, requested_at, approved_by, approved_at, expires_at, executed_at, result, error, connector_kind'

/** The project's clean-up actions, newest first. */
export async function loadActions(db: Db, projectId: string, limit = 30): Promise<HousekeepingActionRow[]> {
  const { data, error } = await db
    .from('connector_actions')
    .select(ACTION_COLUMNS)
    .eq('project_id', projectId)
    .in('action', [...HOUSEKEEPING_ACTIONS])
    .order('requested_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`connector_actions read failed: ${error.message}`)
  return ((data ?? []) as HousekeepingActionRow[]).filter((r) => r.connector_kind === 'github' && isHousekeepingAction(r.action))
}

/** `repo|key` of every item in a clean-up still waiting or running. */
export function pendingKeys(actions: HousekeepingActionRow[]): Set<string> {
  const out = new Set<string>()
  for (const a of actions) {
    if (!['pending_approval', 'approved', 'executing'].includes(a.status)) continue
    const repo = String((a.payload as { repo?: unknown }).repo ?? '').toLowerCase()
    const items = (a.payload as { items?: unknown }).items
    if (Array.isArray(items)) for (const it of items) if (it && typeof (it as { key?: unknown }).key === 'string') out.add(`${repo}|${(it as { key: string }).key}`)
    if (a.action === 'set_delete_branch_on_merge') out.add(`${repo}|setting:delete_branch_on_merge`)
  }
  return out
}

/** Bound GitHub repos of a project, owner/name lower case. */
export async function boundRepos(db: Db, projectId: string): Promise<string[]> {
  const { data, error } = await db.from('project_repos').select('repo_url').eq('project_id', projectId)
  if (error) throw new Error(`project_repos read failed: ${error.message}`)
  const out = new Set<string>()
  for (const r of (data ?? []) as Array<{ repo_url: string | null }>) {
    const ref = parseGithubRepoUrl(r.repo_url ?? '')
    if (ref) out.add(`${ref.owner}/${ref.repo}`.toLowerCase())
  }
  return [...out]
}

export interface RepoPreview {
  repo: string
  /** Why this repo could not be read; the lists are empty then. */
  error: string | null
  defaultBranch: string | null
  deleteBranchOnMerge: boolean | null
  /** The token can turn the setting on. */
  canChangeSetting: boolean
  settingPending: boolean
  branches: BranchCandidate[]
  prs: PrCandidate[]
  kept: KeptItem[]
  keptCount: number
  /** Recorded branches already gone from GitHub. */
  gone: number
  /** A GitHub list stopped at its page cap: some candidates may be missing. */
  truncated: boolean
}

export interface PreviewDeps {
  fetch: FetchLike
  now: () => Date
  /** The project's stored GitHub token (ADR 0037's legacy-backed path: never the App installation or the platform token). */
  token: (db: Db, projectId: string) => Promise<string | null>
}

/** One repo's preview: fresh GitHub lists against what Mushi recorded. */
export async function previewRepo(
  db: Db,
  deps: PreviewDeps,
  input: { projectId: string; repo: string; recorded: Recorded; reviews: ReviewRow[]; riding: Set<number>; pending: Set<string>; staleDays: number },
): Promise<RepoPreview> {
  const repo = input.repo
  const empty: RepoPreview = { repo, error: null, defaultBranch: null, deleteBranchOnMerge: null, canChangeSetting: false, settingPending: input.pending.has(`${repo}|setting:delete_branch_on_merge`), branches: [], prs: [], kept: [], keptCount: 0, gone: 0, truncated: false }
  const token = await deps.token(db, input.projectId)
  if (!token) return { ...empty, error: NO_TOKEN }
  const gh = ghClient(deps.fetch, token)
  const info = await readRepo(gh, repo)
  if (!info.info) return { ...empty, error: info.status === 404 ? 'GitHub did not find this repository with the stored token.' : `GitHub answered ${info.status || 'nothing'} when Mushi read the repository.` }
  const [branchList, openList] = await Promise.all([listBranches(gh, repo), listPulls(gh, repo, 'open', OPEN_PAGES)])
  if (!branchList.ok || !openList.ok) return { ...empty, defaultBranch: info.info.defaultBranch, deleteBranchOnMerge: info.info.deleteBranchOnMerge, error: 'GitHub did not list the branches or open pull requests. Try again in a minute.' }
  const existing = new Set(branchList.branches.map((b) => b.name))
  const recordedHere = input.recorded.branches.filter((b) => b.repo === repo)
  const wanted = new Set(recordedHere.filter((b) => existing.has(b.branch) && b.prNumber).map((b) => b.prNumber as number))
  const closedPulls = new Map<number, GhPull>()
  let closedTruncated = false
  if (wanted.size > 0) {
    const closed = await listPulls(gh, repo, 'closed', CLOSED_PAGES)
    closedTruncated = closed.truncated
    for (const p of closed.pulls) if (wanted.has(p.number)) closedPulls.set(p.number, p)
    let reads = 0
    for (const n of wanted) {
      if (closedPulls.has(n) || reads >= CLOSED_SINGLE_READS) continue
      if (openList.pulls.some((p) => p.number === n)) continue
      reads++
      const one = await readPull(gh, repo, n)
      if (one.pull && one.pull.state === 'closed') closedPulls.set(n, one.pull)
    }
  }
  if (gh.remaining < PREVIEW_GITHUB_FLOOR) return { ...empty, defaultBranch: info.info.defaultBranch, deleteBranchOnMerge: info.info.deleteBranchOnMerge, error: `Fewer than ${PREVIEW_GITHUB_FLOOR} GitHub API calls are left this hour for this token. Try again later.` }
  const openFixNumbers = input.recorded.attempts.filter((a) => a.repo === repo && openList.pulls.some((p) => p.number === a.prNumber)).map((a) => a.prNumber)
  const headCommitAt = await headCommitDates(gh, repo, openFixNumbers)
  const facts: RepoFacts = { repo, defaultBranch: info.info.defaultBranch, branches: branchList.branches, openPulls: openList.pulls, closedPulls, headCommitAt, truncated: branchList.truncated || openList.truncated || closedTruncated }
  const pending = new Set([...input.pending].filter((k) => k.startsWith(`${repo}|`)).map((k) => k.slice(repo.length + 1)))
  const b = branchCandidates(facts, recordedHere, pending)
  const p = prCandidates(facts, input.recorded.attempts, input.reviews, { staleDays: input.staleDays, now: deps.now(), riding: input.riding, pending, activeBranches: input.recorded.activeBranches })
  const kept = [...b.kept, ...p.kept]
  return {
    repo,
    error: null,
    defaultBranch: info.info.defaultBranch,
    deleteBranchOnMerge: info.info.deleteBranchOnMerge,
    canChangeSetting: info.info.canAdmin,
    settingPending: empty.settingPending,
    branches: b.candidates,
    prs: p.candidates,
    kept: kept.slice(0, KEPT_SHOWN),
    keptCount: kept.length,
    gone: b.gone,
    truncated: facts.truncated,
  }
}
