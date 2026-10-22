/**
 * FILE: packages/server/supabase/functions/_shared/ci-collector.ts
 * PURPOSE: Keep `ci_jobs` / `ci_runners` current for every repository a
 *          project bound (Plan 022 Phase 2):
 *
 *   runCiCollector  — the ci-jobs-collector cron (every 10 min): runs on
 *                     every branch updated in the last 2 h, the jobs of the
 *                     runs not already stored as finished, and the runner
 *                     list. ≤ 40 GitHub calls per tick, shared fairly
 *                     (projects least recently collected go first, each gets
 *                     an even share). Then deletes ci_jobs and
 *                     ci_runner_job_samples older than 30 days.
 *   settleStaleLiveJobs — after both: re-reads, one job at a time, every
 *                     job still stored as queued or running that no read has
 *                     refreshed in 10 min. A run's later attempts list only
 *                     their own jobs (`filter=latest`), and a busy repo pushes
 *                     a run out of the newest 30 before it finishes, so
 *                     without this a finished job read "Running 9 h".
 *   liveSyncProjects — the overview's `refresh=1`: queued and running runs,
 *                     plus runs that finished in the last 15 min, at most
 *                     once a minute per project (ci_claim_live_sync, atomic)
 *                     and ≤ 12 GitHub calls per request. The 10-minute
 *                     collector is too slow for a live queue, and most
 *                     projects use a PAT, so workflow_job webhooks may
 *                     never arrive.
 *
 * Permissions are recorded per repo in ci_collector_state.permissions: a
 * 403 on runs means no Actions: read (jobs 'missing'); a 403/404 on the
 * runner list means no Administration: read (runners 'missing'), which is
 * then retried once a day, not every tick.
 *
 * Everything external is injected (token resolver, fetch, clock), so the
 * vitest suite runs it on the in-memory fake database.
 */

import {
  ciGithub,
  ciJobRow,
  collectRunJobs,
  fetchJobAnnotations,
  fetchJobResult,
  fetchRepoVisibility,
  needsAnnotations,
  upsertCiJobs,
  listRepoRunners,
  listRunsByStatus,
  listRunsUpdatedSince,
  repoFullName,
  runnerRowsFromList,
  type CiGithub,
  type GhRun,
} from './ci-jobs.ts'

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

export const COLLECTOR_CALLS_PER_TICK = 40
export const COLLECTOR_MIN_CALLS_PER_PROJECT = 4
export const COLLECTOR_WINDOW_MS = 2 * 60 * 60_000
export const LIVE_SYNC_CALLS_PER_REQUEST = 12
export const LIVE_SYNC_MIN_INTERVAL_S = 60
export const LIVE_SYNC_FINISHED_WINDOW_MS = 15 * 60_000
export const CI_RETENTION_DAYS = 30
/** A queued or running row no read refreshed for this long is re-read by id. */
export const STALE_LIVE_JOB_MS = 10 * 60_000
/** GitHub calls per collector tick for stale live jobs, on top of the main budget. */
export const SETTLE_CALLS_PER_TICK = 20
/** The same during a live sync, so the page a person is looking at heals itself. */
export const SETTLE_CALLS_PER_LIVE_SYNC = 4
const LIVE_JOB_STATUSES = ['queued', 'in_progress', 'waiting', 'requested', 'pending']
/** A runner list GitHub refused is asked again after this long. */
export const RUNNER_PERMISSION_RECHECK_MS = 24 * 60 * 60_000
/** A repo's visibility is read again after this long (one call per repo a day). */
export const VISIBILITY_RECHECK_MS = 24 * 60 * 60_000

export type PermissionState = 'ok' | 'missing' | 'unknown'
export type RepoVisibility = 'public' | 'private' | 'unknown'
export interface RepoPermissions {
  jobs: PermissionState
  runners: PermissionState
  checkedAt?: string
  runnersCheckedAt?: string
  /**
   * Repo visibility from GET /repos/{o}/{r} (Metadata: read), read once a day.
   * Public repos run standard GitHub-hosted minutes free; private repos pay
   * after the plan's included minutes (Plan 022 Phase 7).
   */
  visibility?: RepoVisibility
  visibilityCheckedAt?: string
  /** The repo owner's login: GitHub's included minutes are per owner account. */
  owner?: string
}

export interface CollectorDeps {
  resolveToken: (db: Db, projectId: string, installationId: number | null) => Promise<string | null>
  fetchImpl?: CiGithub['fetchImpl']
  now: () => Date
}

interface RepoBinding {
  projectId: string
  repo: string
  installationId: number | null
}

/** Every distinct (project, owner/repo) bound in project_repos, optionally only some projects. */
export async function boundRepos(db: Db, projectIds?: readonly string[]): Promise<RepoBinding[]> {
  let q = db.from('project_repos').select('project_id, repo_url, github_app_installation_id')
  if (projectIds) {
    if (projectIds.length === 0) return []
    q = q.in('project_id', projectIds)
  }
  const { data, error } = await q
  if (error) throw new Error(`project_repos read failed: ${error.message}`)
  const seen = new Set<string>()
  const out: RepoBinding[] = []
  for (const r of (data ?? []) as Array<{ project_id: string; repo_url: string | null; github_app_installation_id: unknown }>) {
    const repo = repoFullName(r.repo_url)
    if (!repo) continue
    const key = `${r.project_id}|${repo.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const inst = Number(r.github_app_installation_id)
    out.push({ projectId: r.project_id, repo, installationId: Number.isSafeInteger(inst) && inst > 0 ? inst : null })
  }
  return out
}

interface StateRow {
  project_id: string
  permissions: Record<string, RepoPermissions> | null
  last_collected_at: string | null
  last_live_sync_at: string | null
}

async function readStates(db: Db, projectIds: string[]): Promise<Map<string, StateRow>> {
  if (projectIds.length === 0) return new Map()
  const { data } = await db
    .from('ci_collector_state')
    .select('project_id, permissions, last_collected_at, last_live_sync_at')
    .in('project_id', projectIds)
  return new Map(((data ?? []) as StateRow[]).map((s) => [s.project_id, s]))
}

/** Runs worth reading jobs for: not finished, or finished but not stored as finished. */
async function runsToRead(db: Db, projectId: string, repo: string, runs: GhRun[]): Promise<GhRun[]> {
  if (runs.length === 0) return []
  const { data } = await db
    .from('ci_jobs')
    .select('run_id, status')
    .eq('project_id', projectId)
    .eq('repo', repo)
    .in('run_id', runs.map((r) => r.id))
  const stored = new Map<number, { all: number; done: number }>()
  for (const j of (data ?? []) as Array<{ run_id: number; status: string }>) {
    const s = stored.get(Number(j.run_id)) ?? { all: 0, done: 0 }
    s.all++
    if (j.status === 'completed') s.done++
    stored.set(Number(j.run_id), s)
  }
  return runs.filter((r) => {
    const s = stored.get(r.id)
    return !(r.status === 'completed' && s && s.all > 0 && s.done === s.all)
  })
}

/**
 * Read one repo within `gh`'s budget. Returns the permission states learned
 * (`undefined` = not asked this time) and the number of jobs stored.
 */
async function collectRepo(
  db: Db,
  gh: CiGithub,
  binding: RepoBinding,
  prior: RepoPermissions | undefined,
  now: Date,
  opts: { mode: 'collect' | 'live' },
): Promise<{ jobs?: PermissionState; runners?: PermissionState; visibility?: { value: RepoVisibility; owner: string | null }; stored: number; error: string | null }> {
  let runs: GhRun[] = []
  let jobsState: PermissionState | undefined
  if (opts.mode === 'collect') {
    const res = await listRunsUpdatedSince(gh, binding.repo, new Date(now.getTime() - COLLECTOR_WINDOW_MS).toISOString(), 30)
    if (res.status === 0) return { stored: 0, error: null }
    if (res.status === 403) return { jobs: 'missing', stored: 0, error: null }
    if (res.status !== 200 || !res.body) return { jobs: 'unknown', stored: 0, error: `runs ${res.status}` }
    jobsState = 'ok'
    runs = res.body
  } else {
    const seen = new Set<number>()
    for (const status of ['queued', 'in_progress', 'completed'] as const) {
      const res = await listRunsByStatus(gh, binding.repo, status, 20)
      if (res.status === 0) break
      if (res.status === 403) return { jobs: 'missing', stored: 0, error: null }
      if (res.status !== 200 || !res.body) continue
      jobsState = 'ok'
      const since = now.getTime() - LIVE_SYNC_FINISHED_WINDOW_MS
      for (const r of res.body) {
        if (seen.has(r.id)) continue
        if (status === 'completed' && !(Date.parse(r.updated_at ?? '') >= since)) continue
        seen.add(r.id)
        runs.push(r)
      }
    }
  }

  // The runner list: every tick while it works; once a day after GitHub refused it.
  let runnersState: PermissionState | undefined
  const recheck = !prior?.runnersCheckedAt || now.getTime() - Date.parse(prior.runnersCheckedAt) >= RUNNER_PERMISSION_RECHECK_MS
  if (opts.mode === 'collect' && (prior?.runners !== 'missing' || recheck) && gh.budget.remaining > 0) {
    const list = await listRepoRunners(gh, binding.repo)
    runnersState = list.status
    if (list.status === 'ok' && list.runners.length > 0) {
      await db.from('ci_runners').upsert(runnerRowsFromList(binding.projectId, binding.repo, list.runners, now), {
        onConflict: 'project_id,repo,runner_name',
      })
    }
  }

  // Visibility once a day, after the runner list, and only with budget to spare.
  let visibility: { value: RepoVisibility; owner: string | null } | undefined
  const visibilityDue = !prior?.visibilityCheckedAt || now.getTime() - Date.parse(prior.visibilityCheckedAt) >= VISIBILITY_RECHECK_MS
  if (opts.mode === 'collect' && visibilityDue && gh.budget.remaining > 1) {
    const v = await fetchRepoVisibility(gh, binding.repo)
    if (v.status !== 0) visibility = { value: v.visibility, owner: v.owner }
  }

  const due = await runsToRead(db, binding.projectId, binding.repo, runs)
  const out = await collectRunJobs(db, gh, {
    projectId: binding.projectId,
    repo: binding.repo,
    runs: due,
    source: 'poll',
    now,
    maxAnnotationCalls: opts.mode === 'live' ? 1 : 3,
  })
  return { jobs: jobsState, runners: runnersState, visibility, stored: out.rows.length, error: out.error }
}

function mergePermissions(
  prior: RepoPermissions | undefined,
  got: { jobs?: PermissionState; runners?: PermissionState; visibility?: { value: RepoVisibility; owner: string | null } },
  now: Date,
): RepoPermissions {
  const nowIso = now.toISOString()
  const out: RepoPermissions = {
    jobs: got.jobs ?? prior?.jobs ?? 'unknown',
    runners: got.runners ?? prior?.runners ?? 'unknown',
    checkedAt: got.jobs ? nowIso : prior?.checkedAt,
    runnersCheckedAt: got.runners ? nowIso : prior?.runnersCheckedAt,
  }
  // A failed read (403/5xx → unknown) keeps the last known visibility.
  const visibility = got.visibility && got.visibility.value !== 'unknown' ? got.visibility.value : prior?.visibility
  if (visibility) out.visibility = visibility
  const checked = got.visibility ? nowIso : prior?.visibilityCheckedAt
  if (checked) out.visibilityCheckedAt = checked
  const owner = got.visibility?.owner ?? prior?.owner
  if (owner) out.owner = owner
  return out
}

export interface CollectorSummary {
  projects: number
  repos: number
  calls: number
  stored: number
  skippedForBudget: number
  /** Stale queued / running jobs re-read by id this tick. */
  settled: number
  deleted: { jobs: number | null; samples: number | null }
}

export async function runCiCollector(db: Db, deps: CollectorDeps, opts: { projectIds?: string[]; calls?: number } = {}): Promise<CollectorSummary> {
  const now = deps.now()
  const bindings = await boundRepos(db, opts.projectIds)
  const byProject = new Map<string, RepoBinding[]>()
  for (const b of bindings) byProject.set(b.projectId, [...(byProject.get(b.projectId) ?? []), b])
  const states = await readStates(db, [...byProject.keys()])
  // Least recently collected first, so a project skipped for budget leads next tick.
  const order = [...byProject.keys()].sort((a, b) => {
    const ta = Date.parse(states.get(a)?.last_collected_at ?? '') || 0
    const tb = Date.parse(states.get(b)?.last_collected_at ?? '') || 0
    return ta - tb
  })

  let remaining = opts.calls ?? COLLECTOR_CALLS_PER_TICK
  const share = Math.max(COLLECTOR_MIN_CALLS_PER_PROJECT, Math.ceil(remaining / Math.max(1, order.length)))
  const summary: CollectorSummary = { projects: 0, repos: 0, calls: 0, stored: 0, skippedForBudget: 0, settled: 0, deleted: { jobs: null, samples: null } }
  const tokens = new Map<string, string | null>()

  for (const projectId of order) {
    if (remaining <= 0) {
      summary.skippedForBudget++
      continue
    }
    const repos = byProject.get(projectId) ?? []
    const permissions: Record<string, RepoPermissions> = { ...(states.get(projectId)?.permissions ?? {}) }
    let lastError: string | null = null
    let projectCalls = Math.min(share, remaining)
    for (const binding of repos) {
      if (projectCalls <= 0) break
      const tokenKey = `${projectId}|${binding.installationId ?? ''}`
      if (!tokens.has(tokenKey)) tokens.set(tokenKey, await deps.resolveToken(db, projectId, binding.installationId))
      const token = tokens.get(tokenKey)
      if (!token) {
        lastError = 'no_github_token'
        continue
      }
      const gh = ciGithub(token, projectCalls, deps.fetchImpl)
      try {
        const got = await collectRepo(db, gh, binding, permissions[binding.repo], now, { mode: 'collect' })
        permissions[binding.repo] = mergePermissions(permissions[binding.repo], got, now)
        summary.stored += got.stored
        if (got.error) lastError = got.error
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
      projectCalls -= gh.budget.used
      remaining -= gh.budget.used
      summary.calls += gh.budget.used
      summary.repos++
    }
    summary.projects++
    await db.from('ci_collector_state').upsert(
      { project_id: projectId, permissions, last_collected_at: now.toISOString(), last_error: lastError?.slice(0, 300) ?? null, updated_at: now.toISOString() },
      { onConflict: 'project_id' },
    )
  }

  summary.settled = await settleStaleLiveJobs(db, deps, { calls: SETTLE_CALLS_PER_TICK, now, bindings, tokens })
  summary.deleted = await deleteExpiredCiRows(db, now)
  return summary
}

interface StaleLiveRow {
  project_id: string
  repo: string
  job_id: number
  run_id: number
  event: string | null
  pr_number: number | null
}

/**
 * Re-read, by job id, jobs still stored as queued or running that no read
 * refreshed in STALE_LIVE_JOB_MS, oldest first, within `calls` GitHub calls.
 * `GET /actions/jobs/{id}` answers for any run attempt. The run's event and
 * PR number are not on that answer, so they are kept from the stored row.
 * A job GitHub no longer has (404, its run was deleted) is closed as
 * cancelled with that reason, so it stops reading "Running" and stops coming
 * back to the head of this queue.
 */
export async function settleStaleLiveJobs(
  db: Db,
  deps: CollectorDeps,
  opts: { calls: number; now: Date; projectIds?: readonly string[]; bindings?: RepoBinding[]; tokens?: Map<string, string | null> },
): Promise<number> {
  if (opts.calls <= 0) return 0
  let q = db
    .from('ci_jobs')
    .select('project_id, repo, job_id, run_id, event, pr_number')
    .in('status', LIVE_JOB_STATUSES)
    .lt('updated_at', new Date(opts.now.getTime() - STALE_LIVE_JOB_MS).toISOString())
  if (opts.projectIds) q = q.in('project_id', opts.projectIds)
  const { data, error } = await q.order('updated_at', { ascending: true }).limit(opts.calls)
  if (error || !data?.length) return 0

  const rows = data as StaleLiveRow[]
  const bindings = opts.bindings ?? (await boundRepos(db, [...new Set(rows.map((r) => r.project_id))]))
  const tokens = opts.tokens ?? new Map<string, string | null>()
  let remaining = opts.calls
  const fresh = []
  const gone: StaleLiveRow[] = []
  for (const stale of rows) {
    if (remaining <= 0) break
    const binding = bindings.find((b) => b.projectId === stale.project_id && b.repo === stale.repo)
    if (!binding) continue
    const tokenKey = `${binding.projectId}|${binding.installationId ?? ''}`
    if (!tokens.has(tokenKey)) tokens.set(tokenKey, await deps.resolveToken(db, binding.projectId, binding.installationId))
    const token = tokens.get(tokenKey)
    if (!token) continue
    const gh = ciGithub(token, remaining, deps.fetchImpl)
    const res = await fetchJobResult(gh, stale.repo, stale.job_id)
    if (res.status === 404) {
      remaining -= gh.budget.used
      gone.push(stale)
      continue
    }
    const job = res.status === 200 ? res.body : null
    let annotations: string[] | null = null
    if (job && needsAnnotations(job) && gh.budget.remaining > 0) annotations = await fetchJobAnnotations(gh, job.check_run_url)
    remaining -= gh.budget.used
    if (!job) continue
    const row = ciJobRow({ projectId: stale.project_id, repo: stale.repo, job, annotations, source: 'poll', now: opts.now })
    if (!row) continue
    row.event = row.event ?? stale.event
    row.pr_number = row.pr_number ?? stale.pr_number
    fresh.push(row)
  }
  for (const g of gone) {
    await db
      .from('ci_jobs')
      .update({
        status: 'completed',
        conclusion: 'cancelled',
        ci_kind: 'cancelled',
        infra: false,
        infra_detail: 'GitHub no longer has this job; its run was deleted.',
        updated_at: opts.now.toISOString(),
      })
      .eq('project_id', g.project_id)
      .eq('repo', g.repo)
      .eq('job_id', g.job_id)
  }
  if (fresh.length === 0) return gone.length
  const stored = await upsertCiJobs(db, fresh)
  return (stored.error ? 0 : fresh.length) + gone.length
}

/** Retention: ci_jobs and ci_runner_job_samples are kept 30 days. */
export async function deleteExpiredCiRows(db: Db, now: Date): Promise<{ jobs: number | null; samples: number | null }> {
  const cutoff = new Date(now.getTime() - CI_RETENTION_DAYS * 24 * 60 * 60_000).toISOString()
  const jobs = await db.from('ci_jobs').delete({ count: 'exact' }).lt('gh_created_at', cutoff)
  const samples = await db.from('ci_runner_job_samples').delete({ count: 'exact' }).lt('at', cutoff)
  return { jobs: jobs?.error ? null : jobs?.count ?? null, samples: samples?.error ? null : samples?.count ?? null }
}

export interface LiveSyncResult {
  /** Projects this request synced (the others were synced less than a minute ago by someone else). */
  synced: string[]
  calls: number
  /** The newest live sync of any scoped project, or null when none ever ran. */
  refreshedAt: string | null
}

/**
 * The overview's `refresh=1`. Claims each project (once a minute, atomic
 * across parallel requests), then reads queued, running and just-finished
 * runs within one 12-call budget for the whole request.
 */
export async function liveSyncProjects(db: Db, deps: CollectorDeps, projectIds: string[], opts: { calls?: number } = {}): Promise<LiveSyncResult> {
  const now = deps.now()
  const result: LiveSyncResult = { synced: [], calls: 0, refreshedAt: null }
  let remaining = opts.calls ?? LIVE_SYNC_CALLS_PER_REQUEST
  const bindings = await boundRepos(db, projectIds)
  const byProject = new Map<string, RepoBinding[]>()
  for (const b of bindings) byProject.set(b.projectId, [...(byProject.get(b.projectId) ?? []), b])

  for (const projectId of projectIds) {
    const repos = byProject.get(projectId)
    if (!repos?.length || remaining <= 0) continue
    const { data: claimed, error } = await db.rpc('ci_claim_live_sync', { p_project_id: projectId, p_min_interval_seconds: LIVE_SYNC_MIN_INTERVAL_S })
    if (error || claimed !== true) continue
    result.synced.push(projectId)
    for (const binding of repos) {
      if (remaining <= 0) break
      const token = await deps.resolveToken(db, projectId, binding.installationId)
      if (!token) continue
      const gh = ciGithub(token, remaining, deps.fetchImpl)
      try {
        await collectRepo(db, gh, binding, undefined, now, { mode: 'live' })
      } catch {
        // A failed live read leaves the stored jobs as they were; the page still renders.
      }
      remaining -= gh.budget.used
      result.calls += gh.budget.used
    }
  }

  // Heal jobs this page would show as running long after they finished.
  if (result.synced.length > 0) {
    await settleStaleLiveJobs(db, deps, { calls: SETTLE_CALLS_PER_LIVE_SYNC, now, projectIds: result.synced, bindings }).catch(() => 0)
  }

  const states = await readStates(db, projectIds)
  for (const s of states.values()) {
    if (s.last_live_sync_at && (!result.refreshedAt || s.last_live_sync_at > result.refreshedAt)) result.refreshedAt = s.last_live_sync_at
  }
  return result
}

/** Per-repo permission states as stored, for the overview's `permissions`. */
export async function readCiPermissions(db: Db, projectIds: string[]): Promise<Record<string, RepoPermissions>> {
  const states = await readStates(db, projectIds)
  const out: Record<string, RepoPermissions> = {}
  for (const s of states.values()) Object.assign(out, s.permissions ?? {})
  return out
}
