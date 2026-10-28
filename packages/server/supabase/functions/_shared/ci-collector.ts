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
 *                     an even share). Within each project's share it also
 *                     lists closed pull requests once a day per repo and
 *                     reads up to two PR file lists (ci_pull_requests, for
 *                     the cost rules). With the calls left over it reads each
 *                     GitHub owner's Actions bill once a day (syncBilling →
 *                     ci_billing_daily). Then deletes ci_jobs,
 *                     ci_runner_job_samples and ci_pull_requests older than
 *                     30 days, and bill rows older than 400.
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
  listClosedPullRequests,
  listRepoRunners,
  listRunsByStatus,
  pullRequestDocsOnly,
  listRunsUpdatedSince,
  repoFullName,
  runnerRowsFromList,
  type CiGithub,
  type GhRun,
} from './ci-jobs.ts'
import { evaluateWatch, type WatchJob } from './ci-placement.ts'
import { billingRowsFromUsage, fetchBillingUsage, isGithubLogin, monthsToSync, nextCoveredFrom, type BillingOwnerType } from './ci-billing.ts'

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
  /** GitHub's owner type, 'User' or 'Organization': which billing endpoint reads the owner's bill. */
  ownerType?: string
  /** When the closed pull requests were last listed (once a day). */
  prsCheckedAt?: string
}

export interface CollectorDeps {
  resolveToken: (db: Db, projectId: string, installationId: number | null) => Promise<string | null>
  /**
   * The project's own stored GitHub token for the billing read: never the
   * GitHub App installation (GitHub refuses it the user bill) and never the
   * platform token (it would read the platform owner's bill). Unset = no
   * billing read.
   */
  resolveBillingToken?: (db: Db, projectId: string) => Promise<string | null>
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
): Promise<{ jobs?: PermissionState; runners?: PermissionState; visibility?: { value: RepoVisibility; owner: string | null; ownerType?: string | null }; stored: number; error: string | null }> {
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
  let visibility: { value: RepoVisibility; owner: string | null; ownerType?: string | null } | undefined
  const visibilityDue = !prior?.visibilityCheckedAt || now.getTime() - Date.parse(prior.visibilityCheckedAt) >= VISIBILITY_RECHECK_MS
  if (opts.mode === 'collect' && visibilityDue && gh.budget.remaining > 1) {
    const v = await fetchRepoVisibility(gh, binding.repo)
    if (v.status !== 0) visibility = { value: v.visibility, owner: v.owner, ownerType: v.ownerType }
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
  got: { jobs?: PermissionState; runners?: PermissionState; visibility?: { value: RepoVisibility; owner: string | null; ownerType?: string | null } },
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
  const ownerType = got.visibility?.ownerType ?? prior?.ownerType
  if (ownerType) out.ownerType = ownerType
  if (prior?.prsCheckedAt) out.prsCheckedAt = prior.prsCheckedAt
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
  /** CI placement watches updated this tick (ADR 0037). */
  watches: number
  /** Closed pull requests listed and PR file lists read this tick. */
  prs: { repos: number; stored: number; classified: number }
  /** GitHub bills read this tick (once a day per owner). */
  billing: { owners: number; calls: number; rows: number; unavailable: number }
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
  const summary: CollectorSummary = {
    projects: 0,
    repos: 0,
    calls: 0,
    stored: 0,
    skippedForBudget: 0,
    settled: 0,
    deleted: { jobs: null, samples: null },
    watches: 0,
    prs: { repos: 0, stored: 0, classified: 0 },
    billing: { owners: 0, calls: 0, rows: 0, unavailable: 0 },
  }
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
        // Pull request states for the cost rules, with what budget this project has left.
        const prs = await collectPullRequests(db, gh, binding, permissions[binding.repo], now).catch(() => ({ checkedAt: undefined, stored: 0, classified: 0 }))
        if (prs.checkedAt) {
          permissions[binding.repo] = { ...permissions[binding.repo], prsCheckedAt: prs.checkedAt }
          summary.prs.repos++
        }
        summary.prs.stored += prs.stored
        summary.prs.classified += prs.classified
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

  // The real bill, once a day per owner, from the calls this tick left over.
  if (deps.resolveBillingToken && remaining > 0) {
    try {
      const billing = await syncBilling(db, deps, { calls: remaining, now, bindings, permissionsByProject: await readCiPermissionsByProject(db, [...byProject.keys()]) })
      summary.billing = billing
      summary.calls += billing.calls
      remaining -= billing.calls
    } catch {
      // A billing failure never fails the tick; each owner's status records its own errors.
    }
  }

  summary.settled = await settleStaleLiveJobs(db, deps, { calls: SETTLE_CALLS_PER_TICK, now, bindings, tokens })
  summary.watches = await runPlacementWatches(db, now).catch(() => 0)
  summary.deleted = await deleteExpiredCiRows(db, now)
  return summary
}

/** Closed pull requests are listed once a day per repo. */
export const PR_RECHECK_MS = 24 * 60 * 60_000
/** PR file lists read per repo per tick (docs-only or not), when budget is left. */
export const PR_FILES_PER_REPO_PER_TICK = 2
const PR_WINDOW_MS = CI_RETENTION_DAYS * 24 * 60 * 60_000

/**
 * Closed pull requests of the last 30 days (merged or not, draft, head
 * branch) once a day, then the file list of up to two PRs not read yet:
 * whether each changed only documentation. Feeds abandoned_pr_minutes and
 * missing_path_filter. Before ci_pull_requests exists the writes fail and
 * nothing is stored; the list is still asked only once a day.
 */
async function collectPullRequests(
  db: Db,
  gh: CiGithub,
  binding: RepoBinding,
  prior: RepoPermissions | undefined,
  now: Date,
): Promise<{ checkedAt?: string; stored: number; classified: number }> {
  const out: { checkedAt?: string; stored: number; classified: number } = { stored: 0, classified: 0 }
  const since = now.getTime() - PR_WINDOW_MS
  const due = !prior?.prsCheckedAt || now.getTime() - Date.parse(prior.prsCheckedAt) >= PR_RECHECK_MS
  if (due && gh.budget.remaining > 0) {
    const res = await listClosedPullRequests(gh, binding.repo)
    if (res.status !== 0) out.checkedAt = now.toISOString()
    if (res.status === 200 && res.body) {
      const rows = res.body
        .filter((p) => Date.parse(p.updated_at ?? p.closed_at ?? '') >= since)
        .map((p) => ({
          project_id: binding.projectId,
          repo: binding.repo,
          number: p.number,
          state: p.state === 'open' ? 'open' : 'closed',
          merged: !!p.merged_at,
          draft: p.draft === true,
          head_ref: p.head?.ref ? String(p.head.ref).slice(0, 255) : null,
          closed_at: p.closed_at ?? null,
          gh_updated_at: p.updated_at ?? null,
          updated_at: now.toISOString(),
        }))
      if (rows.length > 0) {
        const { error } = await db.from('ci_pull_requests').upsert(rows, { onConflict: 'project_id,repo,number' })
        if (!error) out.stored = rows.length
      }
    }
  }
  if (gh.budget.remaining <= 0) return out
  const { data, error } = await db
    .from('ci_pull_requests')
    .select('number')
    .eq('project_id', binding.projectId)
    .eq('repo', binding.repo)
    .is('files_checked_at', null)
    .gte('closed_at', new Date(since).toISOString())
    .order('closed_at', { ascending: false })
    .limit(PR_FILES_PER_REPO_PER_TICK)
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<{ number: number }>) {
    if (gh.budget.remaining <= 0) break
    const files = await pullRequestDocsOnly(gh, binding.repo, Number(r.number))
    if (files.status === 0) break
    await db
      .from('ci_pull_requests')
      .update({ docs_only: files.docsOnly, files_checked_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('project_id', binding.projectId)
      .eq('repo', binding.repo)
      .eq('number', r.number)
    out.classified++
  }
  return out
}

/** An owner's bill is read once a day. */
export const BILLING_RECHECK_MS = 24 * 60 * 60_000
/** Bill rows are kept this long. */
export const BILLING_RETENTION_DAYS = 400
const BILLING_UPSERT_CHUNK = 500
export const NO_BILLING_TOKEN =
  "No GitHub token is saved for this project, so Mushi cannot read the bill (it never uses the GitHub App or a shared token for billing). Save a token with billing read access in the project's GitHub settings, or run `mushi runner bill --push`."

/** ci_collector_state.permissions per project. */
async function readCiPermissionsByProject(db: Db, projectIds: string[]): Promise<Map<string, Record<string, RepoPermissions>>> {
  const states = await readStates(db, projectIds)
  return new Map([...states.values()].map((s) => [s.project_id, s.permissions ?? {}]))
}

/**
 * Once a day per (organization, GitHub owner) of the bound repos: read this
 * month and last month of the owner's Actions bill (plus older months the
 * previous-period comparison still needs) with the project's own token, and
 * store it in ci_billing_daily. Every attempt is recorded in ci_billing_sync
 * with the plain reason when it failed, so a refusal is retried tomorrow,
 * not every tick. Owners whose months do not fit in `calls` wait for a tick
 * with more budget left. Before the tables exist this does nothing.
 */
export async function syncBilling(
  db: Db,
  deps: CollectorDeps,
  opts: { calls: number; now: Date; bindings: RepoBinding[]; permissionsByProject: Map<string, Record<string, RepoPermissions>> },
): Promise<CollectorSummary['billing']> {
  const out = { owners: 0, calls: 0, rows: 0, unavailable: 0 }
  const { now } = opts
  const resolveBillingToken = deps.resolveBillingToken
  const projectIds = [...new Set(opts.bindings.map((b) => b.projectId))]
  if (projectIds.length === 0 || !resolveBillingToken) return out
  const { data: projects, error } = await db.from('projects').select('id, organization_id').in('id', projectIds)
  if (error) return out
  const orgOf = new Map(((projects ?? []) as Array<{ id: string; organization_id: string | null }>).map((p) => [p.id, p.organization_id]))

  const targets = new Map<string, { orgId: string; owner: string; projectIds: string[]; ownerType: string | null }>()
  for (const b of opts.bindings) {
    const orgId = orgOf.get(b.projectId)
    const owner = b.repo.split('/')[0]
    if (!orgId || !isGithubLogin(owner)) continue
    const key = `${orgId}|${owner.toLowerCase()}`
    const t = targets.get(key) ?? { orgId, owner, projectIds: [], ownerType: null }
    if (!t.projectIds.includes(b.projectId)) t.projectIds.push(b.projectId)
    t.ownerType = t.ownerType ?? opts.permissionsByProject.get(b.projectId)?.[b.repo]?.ownerType ?? null
    targets.set(key, t)
  }
  if (targets.size === 0) return out

  const { data: syncRows, error: syncErr } = await db
    .from('ci_billing_sync')
    .select('organization_id, owner, owner_type, last_attempt_at, last_ok_at, last_source, covered_from')
    .in('organization_id', [...new Set([...targets.values()].map((t) => t.orgId))])
  if (syncErr) return out
  type Prior = { organization_id: string; owner: string; owner_type: string | null; last_attempt_at: string | null; last_ok_at: string | null; last_source: string | null; covered_from: string | null }
  const prior = new Map(((syncRows ?? []) as Prior[]).map((p) => [`${p.organization_id}|${p.owner.toLowerCase()}`, p]))
  const attemptedAt = (k: string) => Date.parse(prior.get(k)?.last_attempt_at ?? '') || 0
  const due = [...targets.entries()]
    .filter(([k]) => now.getTime() - attemptedAt(k) >= BILLING_RECHECK_MS)
    .sort((a, b) => attemptedAt(a[0]) - attemptedAt(b[0]))

  let remaining = opts.calls
  for (const [key, t] of due) {
    const p = prior.get(key)
    const months = monthsToSync(now, p?.covered_from ?? null)
    if (remaining < months.length) break
    out.owners++
    // Stored lowercase: the keys are case-sensitive, GitHub logins are not.
    const owner = (p?.owner ?? t.owner).toLowerCase()
    let token: string | null = null
    for (const pid of t.projectIds) {
      token = await resolveBillingToken(db, pid).catch(() => null)
      if (token) break
    }
    const knownType = t.ownerType === 'User' || t.ownerType === 'Organization' ? t.ownerType : p?.owner_type === 'Organization' || p?.owner_type === 'User' ? p.owner_type : null
    const ownerType: BillingOwnerType = knownType === 'Organization' ? 'Organization' : 'User'
    let lastError: string | null = null
    const results: Array<{ year: number; month: number; ok: boolean }> = []
    if (!token) {
      lastError = NO_BILLING_TOKEN
      out.unavailable++
    } else {
      for (const m of months) {
        remaining--
        out.calls++
        const res = await fetchBillingUsage({ token, owner, ownerType, year: m.year, month: m.month, fetchImpl: deps.fetchImpl })
        if (!res.ok) {
          results.push({ ...m, ok: false })
          lastError = res.reason
          if (res.unavailable) {
            out.unavailable++
            break
          }
          continue
        }
        const { rows } = billingRowsFromUsage(owner, res.items)
        let stored = true
        for (let i = 0; i < rows.length && stored; i += BILLING_UPSERT_CHUNK) {
          const chunk = rows.slice(i, i + BILLING_UPSERT_CHUNK).map((r) => ({ ...r, organization_id: t.orgId, source: 'api', fetched_at: now.toISOString() }))
          const { error: upErr } = await db.from('ci_billing_daily').upsert(chunk, { onConflict: 'organization_id,owner,day,repo,sku' })
          if (upErr) stored = false
        }
        if (!stored) {
          results.push({ ...m, ok: false })
          lastError = 'The bill was read but could not be stored.'
          break
        }
        out.rows += rows.length
        if (res.incomplete) lastError = 'GitHub returned more usage than one page, so part of a month may be missing.'
        results.push({ ...m, ok: !res.incomplete })
      }
    }
    const currentOk = results[0]?.ok === true
    await db.from('ci_billing_sync').upsert(
      {
        organization_id: t.orgId,
        owner,
        owner_type: knownType,
        last_attempt_at: now.toISOString(),
        last_ok_at: currentOk ? now.toISOString() : (p?.last_ok_at ?? null),
        last_error: lastError?.slice(0, 500) ?? null,
        last_source: currentOk ? 'api' : (p?.last_source ?? null),
        covered_from: nextCoveredFrom(p?.covered_from ?? null, results, now, p?.last_ok_at ?? null),
        updated_at: now.toISOString(),
      },
      { onConflict: 'organization_id,owner' },
    )
  }
  return out
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

/**
 * After a CI placement change ran (ADR 0037): look at the next jobs that read
 * the variable, in ci_jobs (no GitHub call), and mark each open watch ok,
 * alert (a job asked for another label or waited over 30 min) or expired.
 * Before the ci_placement_watches table exists this does nothing.
 */
export async function runPlacementWatches(db: Db, now: Date): Promise<number> {
  const { data, error } = await db
    .from('ci_placement_watches')
    .select('id, project_id, repo, jobs, expected_labels, started_at, status')
    .eq('status', 'watching')
    .order('started_at', { ascending: true })
    .limit(50)
  if (error || !Array.isArray(data)) return 0
  let updated = 0
  for (const w of data as Array<{ id: string; project_id: string | null; repo: string; jobs: Array<{ workflow: string; job: string }> | null; expected_labels: string[] | null; started_at: string }>) {
    let q = db
      .from('ci_jobs')
      .select('workflow_name, job_name, runner_labels, queue_seconds, gh_created_at, head_branch, html_url')
      .eq('repo', w.repo)
      .gte('gh_created_at', w.started_at)
      .order('gh_created_at', { ascending: true })
      .limit(300)
    if (w.project_id) q = q.eq('project_id', w.project_id)
    const { data: jobs, error: jobsErr } = await q
    if (jobsErr) continue
    const r = evaluateWatch({ jobs: w.jobs ?? [], expectedLabels: w.expected_labels ?? [], startedAt: w.started_at }, (jobs ?? []) as WatchJob[], now)
    await db
      .from('ci_placement_watches')
      .update({
        status: r.status,
        jobs_seen: r.jobsSeen,
        unexpected: r.unexpected.length,
        slow: r.slow.length,
        detail: { unexpected: r.unexpected.slice(0, 10), slow: r.slow.slice(0, 10) },
        last_checked_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', w.id)
      .eq('status', 'watching')
    updated++
  }
  return updated
}

/** Retention: ci_jobs and ci_runner_job_samples are kept 30 days. */
export async function deleteExpiredCiRows(db: Db, now: Date): Promise<{ jobs: number | null; samples: number | null }> {
  const cutoff = new Date(now.getTime() - CI_RETENTION_DAYS * 24 * 60 * 60_000).toISOString()
  const jobs = await db.from('ci_jobs').delete({ count: 'exact' }).lt('gh_created_at', cutoff)
  const samples = await db.from('ci_runner_job_samples').delete({ count: 'exact' }).lt('at', cutoff)
  // Best effort: these tables may not be applied yet.
  await db.from('ci_pull_requests').delete().lt('updated_at', cutoff)
  await db.from('ci_billing_daily').delete().lt('day', new Date(now.getTime() - BILLING_RETENTION_DAYS * 24 * 60 * 60_000).toISOString().slice(0, 10))
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
