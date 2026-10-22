/**
 * FILE: packages/server/supabase/functions/_shared/ci-jobs.ts
 * PURPOSE: Read GitHub Actions runs, jobs, annotations and runners, map each
 *          job to a `ci_jobs` row with its infra verdict (ci-infra.ts), and
 *          store them (Plan 022). Shared by ci-sync (the fix loop), the
 *          ci-jobs-collector cron, the overview's live sync and the
 *          workflow_job webhook, so every path writes the same row.
 *
 * Every GitHub call goes through a `CiGithub` context that carries a call
 * budget: the collector shares 40 calls per tick across projects, the live
 * sync 12 per request, ci-sync ~9 per PR head. A spent budget answers
 * `{ status: 0 }` instead of calling, so callers stop instead of throwing.
 *
 * Needs Actions: read for runs, jobs and annotations; the runner list needs
 * Administration: read, and a 403/404 there is reported as 'missing'.
 */

import { fetchWithTimeout } from './http.ts'
import {
  classifyCiJob,
  runnerKindOf,
  runnerTookJob,
  summarizeCiJobs,
  type CiJobInput,
  type CiJobKind,
  type CiJobVerdict,
  type CiRunnerKind,
  type FixCiInfra,
} from './ci-infra.ts'

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any }

const API = 'https://api.github.com'
/** Runs read per PR head in the fix loop. */
export const MAX_RUNS_PER_SHA = 5
/** Annotation reads per PR head (one per cancelled / failed job). */
export const MAX_ANNOTATION_CALLS_PER_SHA = 3
const MAX_STEPS = 40
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

export interface CiGithub {
  token: string
  /** Calls left; decremented by every request, never below 0. */
  budget: { remaining: number; used: number }
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
}

export function ciGithub(token: string, calls: number, fetchImpl?: CiGithub['fetchImpl']): CiGithub {
  return { token, budget: { remaining: calls, used: 0 }, fetchImpl }
}

export interface GhResult<T> {
  /** HTTP status; 0 when the budget was spent and no call was made. */
  status: number
  body: T | null
}

async function ghRequest<T>(gh: CiGithub, url: string, method: 'GET' | 'POST' = 'GET'): Promise<GhResult<T>> {
  if (gh.budget.remaining <= 0) return { status: 0, body: null }
  gh.budget.remaining--
  gh.budget.used++
  const doFetch = gh.fetchImpl ?? ((u: string, init: RequestInit) => fetchWithTimeout(u, init))
  const res = await doFetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${gh.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mushi-mushi-ci',
    },
  })
  const body = res.status === 204 ? null : ((await res.json().catch(() => null)) as T | null)
  return { status: res.status, body }
}

/** `owner/repo` from a GitHub URL or full name; null when it is neither. */
export function repoFullName(value: string | null | undefined): string | null {
  if (!value) return null
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(value.trim())
  if (!m) return null
  const full = `${m[1]}/${m[2]}`
  return REPO_RE.test(full) ? full : null
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub shapes (the fields Mushi reads)
// ─────────────────────────────────────────────────────────────────────────────

export interface GhRun {
  id: number
  run_attempt?: number | null
  name?: string | null
  event?: string | null
  status?: string | null
  conclusion?: string | null
  head_branch?: string | null
  head_sha?: string | null
  created_at?: string | null
  updated_at?: string | null
  html_url?: string | null
  pull_requests?: Array<{ number?: number | null }> | null
}

export interface GhJob extends CiJobInput {
  id: number
  run_id: number
  run_attempt?: number | null
  name?: string | null
  workflow_name?: string | null
  head_branch?: string | null
  head_sha?: string | null
  runner_group_name?: string | null
  html_url?: string | null
  check_run_url?: string | null
  steps?: Array<{ name?: string | null; status?: string | null; conclusion?: string | null; started_at?: string | null; completed_at?: string | null }> | null
}

export interface GhRunner {
  id?: number
  name?: string
  os?: string | null
  status?: string | null
  busy?: boolean | null
  ephemeral?: boolean | null
  labels?: Array<{ name?: string } | string> | null
}

function runsPath(repo: string, params: Record<string, string>): string {
  return `${API}/repos/${repo}/actions/runs?${new URLSearchParams(params).toString()}`
}

/** The runs on a PR head, newest first (≤ MAX_RUNS_PER_SHA). */
export async function listRunsForHeadSha(gh: CiGithub, repo: string, sha: string): Promise<GhResult<GhRun[]>> {
  const res = await ghRequest<{ workflow_runs?: GhRun[] }>(gh, runsPath(repo, { head_sha: sha, per_page: String(MAX_RUNS_PER_SHA) }))
  return { status: res.status, body: res.body ? (res.body.workflow_runs ?? []).slice(0, MAX_RUNS_PER_SHA) : null }
}

/**
 * Runs on every branch updated since `sinceIso`. GitHub has no "updated"
 * filter, so this reads the newest `perPage` runs and keeps the ones that
 * changed in the window (a run created earlier that is still going counts).
 */
export async function listRunsUpdatedSince(gh: CiGithub, repo: string, sinceIso: string, perPage = 30): Promise<GhResult<GhRun[]>> {
  const res = await ghRequest<{ workflow_runs?: GhRun[] }>(gh, runsPath(repo, { per_page: String(perPage) }))
  if (!res.body) return { status: res.status, body: null }
  const since = Date.parse(sinceIso)
  return {
    status: res.status,
    body: (res.body.workflow_runs ?? []).filter((r) => {
      const t = Date.parse(r.updated_at ?? r.created_at ?? '')
      return Number.isFinite(t) && t >= since
    }),
  }
}

/** Runs in one state (`queued`, `in_progress`, `completed`), newest first. */
export async function listRunsByStatus(gh: CiGithub, repo: string, status: 'queued' | 'in_progress' | 'completed', perPage = 20): Promise<GhResult<GhRun[]>> {
  const res = await ghRequest<{ workflow_runs?: GhRun[] }>(gh, runsPath(repo, { status, per_page: String(perPage) }))
  return { status: res.status, body: res.body ? res.body.workflow_runs ?? [] : null }
}

/** The latest attempt's jobs of a run (`filter=latest`). */
export async function listJobsForRun(gh: CiGithub, repo: string, runId: number): Promise<GhResult<GhJob[]>> {
  const res = await ghRequest<{ jobs?: GhJob[] }>(gh, `${API}/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`)
  return { status: res.status, body: res.body ? res.body.jobs ?? [] : null }
}

const CHECK_RUN_URL_RE = /^https:\/\/api\.github\.com\/repos\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/check-runs\/\d+$/

/** The messages of a job's check-run annotations (where "lost communication" lives). */
export async function fetchJobAnnotations(gh: CiGithub, checkRunUrl: string | null | undefined): Promise<string[] | null> {
  if (!checkRunUrl || !CHECK_RUN_URL_RE.test(checkRunUrl)) return null
  const res = await ghRequest<Array<{ message?: string | null; title?: string | null }>>(gh, `${checkRunUrl}/annotations?per_page=20`)
  if (res.status !== 200 || !Array.isArray(res.body)) return null
  return res.body.map((a) => [a.title, a.message].filter(Boolean).join(': ')).filter(Boolean).slice(0, 20)
}

/** The repo's self-hosted runners; `missing` when the token lacks Administration: read. */
export async function listRepoRunners(gh: CiGithub, repo: string): Promise<{ status: 'ok' | 'missing' | 'unknown'; runners: GhRunner[] }> {
  const res = await ghRequest<{ runners?: GhRunner[] }>(gh, `${API}/repos/${repo}/actions/runners?per_page=100`)
  if (res.status === 200) return { status: 'ok', runners: res.body?.runners ?? [] }
  if (res.status === 403 || res.status === 404) return { status: 'missing', runners: [] }
  return { status: 'unknown', runners: [] }
}

/**
 * The repo's visibility (`GET /repos/{o}/{r}`, Metadata: read). Public repos
 * run standard GitHub-hosted minutes free; private repos pay after the plan's
 * included minutes. 'unknown' when GitHub did not answer 200.
 */
export async function fetchRepoVisibility(gh: CiGithub, repo: string): Promise<{ status: number; visibility: 'public' | 'private' | 'unknown'; owner: string | null; ownerType: string | null }> {
  const res = await ghRequest<{ private?: boolean; visibility?: string; owner?: { login?: string; type?: string } }>(gh, `${API}/repos/${repo}`)
  if (res.status !== 200 || !res.body) return { status: res.status, visibility: 'unknown', owner: null, ownerType: null }
  const v = typeof res.body.private === 'boolean' ? (res.body.private ? 'private' : 'public') : res.body.visibility === 'public' ? 'public' : res.body.visibility ? 'private' : 'unknown'
  return { status: res.status, visibility: v, owner: res.body.owner?.login ?? null, ownerType: res.body.owner?.type ?? null }
}

/** POST rerun-failed-jobs for a run. 201 = queued; 403 = the token cannot write Actions. */
export async function rerunFailedJobs(gh: CiGithub, repo: string, runId: number): Promise<number> {
  const res = await ghRequest<unknown>(gh, `${API}/repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`, 'POST')
  return res.status
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping
// ─────────────────────────────────────────────────────────────────────────────

export interface CiJobRow {
  project_id: string
  repo: string
  run_id: number
  run_attempt: number
  job_id: number
  workflow_name: string | null
  job_name: string
  event: string | null
  head_branch: string | null
  head_sha: string | null
  pr_number: number | null
  status: string
  conclusion: string | null
  gh_created_at: string
  started_at: string | null
  completed_at: string | null
  queue_seconds: number | null
  duration_seconds: number | null
  runner_name: string | null
  runner_group_name: string | null
  runner_labels: string[]
  runner_kind: CiRunnerKind
  ci_kind: CiJobKind
  infra: boolean
  infra_detail: string | null
  steps: Array<{ name: string; conclusion: string | null; seconds: number | null }>
  html_url: string | null
  source: 'poll' | 'webhook'
  updated_at: string
}

const JOB_STATUSES = new Set(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'])

function stepSeconds(s: { started_at?: string | null; completed_at?: string | null }): number | null {
  const a = Date.parse(s.started_at ?? '')
  const b = Date.parse(s.completed_at ?? '')
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 1000)) : null
}

/**
 * One `ci_jobs` row for a GitHub job (REST or `workflow_job` payload, same
 * shape). `run` adds the event and PR number when the caller has it.
 * Null when the job lacks an id, a run id or a creation time.
 */
export function ciJobRow(input: {
  projectId: string
  repo: string
  job: GhJob
  run?: GhRun | null
  annotations?: readonly string[] | null
  source: 'poll' | 'webhook'
  now: Date
}): CiJobRow | null {
  const { job, run } = input
  if (!Number.isSafeInteger(job.id) || !Number.isSafeInteger(job.run_id)) return null
  const created = job.created_at ?? job.started_at ?? null
  if (!created || !Number.isFinite(Date.parse(created))) return null
  const status = JOB_STATUSES.has((job.status ?? '').toLowerCase()) ? (job.status ?? '').toLowerCase() : 'queued'
  const labels = (job.labels ?? []).map((l) => String(l)).filter(Boolean).slice(0, 20)
  const verdict = classifyCiJob(job, { annotations: input.annotations ?? null, now: input.now })
  const prNumber = run?.pull_requests?.find((p) => typeof p?.number === 'number')?.number ?? null
  return {
    project_id: input.projectId,
    repo: input.repo,
    run_id: job.run_id,
    run_attempt: Math.max(1, Number(job.run_attempt ?? run?.run_attempt ?? 1) || 1),
    job_id: job.id,
    workflow_name: (job.workflow_name ?? run?.name ?? null)?.slice(0, 200) ?? null,
    job_name: (job.name ?? `job ${job.id}`).slice(0, 200),
    event: run?.event ?? null,
    head_branch: job.head_branch ?? run?.head_branch ?? null,
    head_sha: job.head_sha ?? run?.head_sha ?? null,
    pr_number: prNumber,
    status,
    conclusion: job.conclusion ? job.conclusion.toLowerCase() : null,
    gh_created_at: created,
    // GitHub fills started_at on jobs no runner ever took; store it only when one did.
    started_at: runnerTookJob(job) ? job.started_at ?? null : null,
    completed_at: job.completed_at ?? null,
    queue_seconds: verdict.queuedSeconds,
    duration_seconds: verdict.durationSeconds,
    runner_name: verdict.runner,
    runner_group_name: job.runner_group_name ?? null,
    runner_labels: labels,
    runner_kind: runnerKindOf(job),
    ci_kind: verdict.kind,
    infra: verdict.infra,
    infra_detail: verdict.detail,
    steps: (job.steps ?? []).slice(0, MAX_STEPS).map((s) => ({
      name: (s.name ?? '').slice(0, 200),
      conclusion: s.conclusion ?? null,
      seconds: stepSeconds(s),
    })),
    html_url: job.html_url ?? null,
    source: input.source,
    updated_at: input.now.toISOString(),
  }
}

/** Jobs whose verdict may hinge on an annotation: cancelled or failed after a runner took them. */
export function needsAnnotations(job: GhJob): boolean {
  const c = (job.conclusion ?? '').toLowerCase()
  return (job.status ?? '') === 'completed' && (c === 'cancelled' || c === 'failure') && Boolean(job.check_run_url)
}

/**
 * Store rows. Two rules keep a stored row from getting worse:
 * - a finished job is never moved back to queued / in progress (a late
 *   `workflow_job.queued` delivery after the poll saw it finish);
 * - an infra verdict proved by an annotation is kept when a later read of
 *   the same finished job had no annotations to look at.
 */
export async function upsertCiJobs(db: Db, rows: CiJobRow[]): Promise<{ written: number; error: string | null }> {
  if (rows.length === 0) return { written: 0, error: null }
  const byProject = new Map<string, CiJobRow[]>()
  for (const r of rows) byProject.set(r.project_id, [...(byProject.get(r.project_id) ?? []), r])
  let written = 0
  for (const [projectId, list] of byProject) {
    const { data: existing, error: readErr } = await db
      .from('ci_jobs')
      .select('job_id, run_attempt, status, conclusion, ci_kind, infra, infra_detail')
      .eq('project_id', projectId)
      .in('job_id', list.map((r) => r.job_id))
    if (readErr) return { written, error: readErr.message ?? 'ci_jobs read failed' }
    const prior = new Map<string, { status: string; conclusion: string | null; ci_kind: CiJobKind; infra: boolean; infra_detail: string | null }>()
    for (const e of (existing ?? []) as Array<{ job_id: number; run_attempt: number; status: string; conclusion: string | null; ci_kind: CiJobKind; infra: boolean; infra_detail: string | null }>) {
      prior.set(`${e.job_id}:${e.run_attempt}`, e)
    }
    const out: CiJobRow[] = []
    for (const r of list) {
      const p = prior.get(`${r.job_id}:${r.run_attempt}`)
      if (p?.status === 'completed' && r.status !== 'completed') continue
      if (p?.status === 'completed' && p.infra && !r.infra && p.conclusion === r.conclusion) {
        out.push({ ...r, ci_kind: p.ci_kind, infra: true, infra_detail: p.infra_detail })
      } else {
        out.push(r)
      }
    }
    if (out.length === 0) continue
    const { error } = await db.from('ci_jobs').upsert(out, { onConflict: 'project_id,job_id,run_attempt' })
    if (error) return { written, error: error.message ?? 'ci_jobs upsert failed' }
    written += out.length
  }
  return { written, error: null }
}

/**
 * Keep `ci_runners` in step with the jobs just stored: new runner names are
 * inserted (source 'jobs', first_seen_at = now), and every runner's
 * last_job_at / last_seen_at moves forward. A row the runner list wrote
 * (source 'github_api', with status and busy) is never overwritten here.
 */
export async function noteRunnersFromJobs(db: Db, rows: CiJobRow[], now: Date): Promise<void> {
  const latest = new Map<string, { project_id: string; repo: string; runner_name: string; labels: string[]; kind: CiRunnerKind; at: string }>()
  for (const r of rows) {
    if (!r.runner_name) continue
    const at = r.started_at ?? r.gh_created_at
    const key = `${r.project_id}|${r.repo}|${r.runner_name}`
    const cur = latest.get(key)
    if (!cur || Date.parse(at) > Date.parse(cur.at)) {
      latest.set(key, { project_id: r.project_id, repo: r.repo, runner_name: r.runner_name, labels: r.runner_labels, kind: r.runner_kind, at })
    }
  }
  if (latest.size === 0) return
  const nowIso = now.toISOString()
  const fresh = [...latest.values()]
  await db.from('ci_runners').upsert(
    fresh.map((x) => ({
      project_id: x.project_id,
      repo: x.repo,
      runner_name: x.runner_name,
      labels: x.labels,
      kind: x.kind,
      source: 'jobs',
      last_seen_at: nowIso,
      last_job_at: x.at,
      updated_at: nowIso,
    })),
    { onConflict: 'project_id,repo,runner_name', ignoreDuplicates: true },
  )
  for (const x of fresh) {
    await db
      .from('ci_runners')
      .update({ last_job_at: x.at, last_seen_at: nowIso, updated_at: nowIso })
      .eq('project_id', x.project_id)
      .eq('repo', x.repo)
      .eq('runner_name', x.runner_name)
      .or(`last_job_at.is.null,last_job_at.lt.${x.at}`)
    // A runner first stored as unknown (before the runner-group rule) learns its kind.
    if (x.kind !== 'unknown') {
      await db
        .from('ci_runners')
        .update({ kind: x.kind, updated_at: nowIso })
        .eq('project_id', x.project_id)
        .eq('repo', x.repo)
        .eq('runner_name', x.runner_name)
        .eq('kind', 'unknown')
    }
  }
}

/** `ci_runners` rows from the runner list (Administration: read). */
export function runnerRowsFromList(projectId: string, repo: string, runners: GhRunner[], now: Date) {
  const nowIso = now.toISOString()
  return runners
    .filter((r) => typeof r.name === 'string' && r.name.length > 0 && r.name.length <= 200)
    .map((r) => {
      const labels = (r.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name ?? '')).filter(Boolean).slice(0, 20)
      return {
        project_id: projectId,
        repo,
        runner_name: r.name as string,
        runner_id: typeof r.id === 'number' ? r.id : null,
        os: r.os ?? null,
        status: r.status === 'online' ? 'online' : r.status === 'offline' ? 'offline' : 'unknown',
        busy: typeof r.busy === 'boolean' ? r.busy : null,
        labels,
        ephemeral: typeof r.ephemeral === 'boolean' ? r.ephemeral : null,
        // The runner list only lists self-hosted runners.
        kind: 'self_hosted' as const,
        source: 'github_api' as const,
        last_seen_at: nowIso,
        updated_at: nowIso,
      }
    })
}

/**
 * Read, classify and store every job of `runs` (newest first). Annotations
 * are fetched for at most `maxAnnotationCalls` cancelled / failed jobs.
 * Stops quietly when the budget runs out; `complete` says whether it did.
 */
export async function collectRunJobs(
  db: Db,
  gh: CiGithub,
  input: { projectId: string; repo: string; runs: GhRun[]; source: 'poll' | 'webhook'; now: Date; maxAnnotationCalls?: number },
): Promise<{ rows: CiJobRow[]; complete: boolean; forbidden: boolean; error: string | null }> {
  const rows: CiJobRow[] = []
  let annotationCalls = input.maxAnnotationCalls ?? MAX_ANNOTATION_CALLS_PER_SHA
  let complete = true
  let forbidden = false
  for (const run of input.runs) {
    const jobs = await listJobsForRun(gh, input.repo, run.id)
    if (jobs.status === 0) {
      complete = false
      break
    }
    if (jobs.status === 403 || jobs.status === 404) {
      forbidden = jobs.status === 403
      continue
    }
    for (const job of jobs.body ?? []) {
      let annotations: string[] | null = null
      if (annotationCalls > 0 && needsAnnotations(job) && gh.budget.remaining > 0) {
        annotationCalls--
        annotations = await fetchJobAnnotations(gh, job.check_run_url)
      }
      const row = ciJobRow({ projectId: input.projectId, repo: input.repo, job, run, annotations, source: input.source, now: input.now })
      if (row) rows.push(row)
    }
  }
  const stored = await upsertCiJobs(db, rows)
  if (!stored.error) await noteRunnersFromJobs(db, rows, input.now)
  return { rows, complete, forbidden, error: stored.error }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fix loop: the verdict for one PR head
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `fix_attempts.ci_infra` from the jobs of a PR head: the summary verdict
 * (a code failure wins over infra, infra over a plain cancel) with the job
 * and runner that decided it. Null when the head is green, skipped or has no
 * jobs, so a green head clears the column.
 */
export function fixCiInfraFromRows(rows: readonly CiJobRow[], now: Date): FixCiInfra | null {
  const verdicts: Array<CiJobVerdict & { job: string; runId: number }> = rows.map((r) => ({
    kind: r.ci_kind,
    infra: r.infra,
    runner: r.runner_name,
    queuedSeconds: r.queue_seconds,
    durationSeconds: r.duration_seconds,
    detail: r.infra_detail,
    job: r.job_name,
    runId: r.run_id,
  }))
  const summary = summarizeCiJobs(verdicts)
  if (!summary.worst || summary.kind === 'passed' || summary.kind === 'skipped') return null
  const w = summary.worst
  return {
    kind: summary.kind,
    infra: summary.infra,
    job: w.job,
    runner: w.runner,
    queuedSeconds: w.queuedSeconds,
    detail: w.detail,
    runId: w.runId,
    at: now.toISOString(),
  }
}

/**
 * Read the runs and jobs of a PR head (≤ 5 runs, ≤ 3 annotation reads), store
 * the jobs, and return the head's verdict. `read: false` when GitHub could
 * not be read (no Actions: read, budget spent): the caller then leaves the
 * stored verdict alone instead of clearing it.
 */
export async function refreshFixCiInfra(
  db: Db,
  gh: CiGithub,
  input: { projectId: string; repo: string; headSha: string; now: Date },
): Promise<{ verdict: FixCiInfra | null; read: boolean; rows: CiJobRow[] }> {
  const runs = await listRunsForHeadSha(gh, input.repo, input.headSha)
  if (runs.status !== 200 || !runs.body) return { verdict: null, read: false, rows: [] }
  if (runs.body.length === 0) return { verdict: null, read: true, rows: [] }
  const out = await collectRunJobs(db, gh, {
    projectId: input.projectId,
    repo: input.repo,
    runs: runs.body,
    source: 'poll',
    now: input.now,
    maxAnnotationCalls: MAX_ANNOTATION_CALLS_PER_SHA,
  })
  if (out.rows.length === 0 && (!out.complete || out.forbidden)) return { verdict: null, read: false, rows: [] }
  return { verdict: fixCiInfraFromRows(out.rows, input.now), read: true, rows: out.rows }
}

/** One job by id (`GET /actions/jobs/{id}`); an Actions check run's id is its job id. */
export async function fetchJob(gh: CiGithub, repo: string, jobId: number): Promise<GhJob | null> {
  const res = await ghRequest<GhJob>(gh, `${API}/repos/${repo}/actions/jobs/${jobId}`)
  return res.status === 200 && res.body && typeof res.body.id === 'number' ? res.body : null
}
