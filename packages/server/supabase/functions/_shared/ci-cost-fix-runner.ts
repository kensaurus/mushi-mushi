/**
 * FILE: packages/server/supabase/functions/_shared/ci-cost-fix-runner.ts
 * PURPOSE: One CI cost "Open fix PR" job (ADR 0047): read the workflow file
 *          through the Contents API, apply the edit (`ci-cost-fix.ts`),
 *          record the workflow's billed minutes for the 14 days before, and
 *          open a draft PR with a conventional `ci:` title. After the PR
 *          merges, `refreshCostFixMeasurement` measures the same minutes per
 *          day afterwards, so the console shows the saving that happened.
 *
 *          Used by the `ci-cost-fix-worker` function (the route fires it) and
 *          by the routes' GET (measurement). GitHub and the clock are
 *          injected; tests drive it with a fake DB.
 *
 * Minutes are ESTIMATED like every CI cost surface (ci-minutes.ts): each
 * finished job on a GitHub-hosted runner rounded up to a whole minute;
 * self-hosted jobs bill nothing.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { parseDocument, isScalar } from 'npm:yaml@2'
import { applyCiCostFix, isCiCostFixKind, type CiCostFixKind } from './ci-cost-fix.ts'
import { billedMinutesOf, usdPerMinuteFor } from './ci-minutes.ts'
import { runnerKindOf } from './ci-infra.ts'
import { createPrFromFiles, fetchBaseFileState, resolveBaseBranch, type PrResult } from './github-pr.ts'
import { fetchPullRequest, parseGithubRepoUrl, resolveProjectGithubToken, type GithubRepoRef, type PullRequestSnapshot } from './github.ts'
import type { BaseFileState } from './fix-file-guard.ts'
import { fetchWithTimeout } from './http.ts'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('ci-cost-fix')

export const BASELINE_DAYS = 14
export const MEASURE_DAYS = 14
/** A `running` job older than this was lost (the function died); the next call reclaims it. */
export const COST_FIX_STALE_MS = 10 * 60_000
export const COST_FIX_PR_LABELS = ['mushi-ci-cost']
const DAY_MS = 24 * 60 * 60_000

export const COST_FIX_JOB_COLUMNS =
  'id, project_id, requested_by, repo, workflow_path, kind, status, workflow_name, evidence, month_saving_usd, summary, error_code, error, pr_url, pr_number, branch, commit_sha, baseline, measured, merged_at, closed_at, created_at, started_at, finished_at, updated_at'

export type CostFixStatus = 'queued' | 'running' | 'pr_opened' | 'no_change' | 'refused' | 'failed'

export interface CostFixJobRow {
  id: string
  project_id: string
  requested_by: string | null
  repo: string
  workflow_path: string
  kind: CiCostFixKind
  status: CostFixStatus
  workflow_name: string | null
  evidence: string | null
  month_saving_usd: number | string | null
  summary: string | null
  error_code: string | null
  error: string | null
  pr_url: string | null
  pr_number: number | null
  branch: string | null
  commit_sha: string | null
  baseline: MinutesSeries | null
  measured: MinutesSeries | null
  merged_at: string | null
  closed_at: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
}

export interface MinutesDay {
  /** UTC date, `2026-10-27`. */
  day: string
  minutes: number
  usd: number
  jobs: number
}

/** A workflow's GitHub-hosted billed minutes per UTC day over a window (estimated). */
export interface MinutesSeries {
  from: string
  to: string
  days: number
  /** False while the window is still filling (measured after a recent merge). */
  complete: boolean
  minutes: number
  usd: number
  jobs: number
  perDay: MinutesDay[]
}

/** The job as the routes return it (camelCase, with the measured saving when there is one). */
export interface CostFixJobView {
  id: string
  projectId: string
  repo: string
  workflowPath: string
  workflowName: string | null
  kind: CiCostFixKind
  status: CostFixStatus
  summary: string | null
  errorCode: string | null
  error: string | null
  prUrl: string | null
  prNumber: number | null
  branch: string | null
  monthSavingUsd: number | null
  baseline: MinutesSeries | null
  measured: MinutesSeries | null
  /** After merge: (baseline − measured) per day, and ×30 in USD. Null until there is a measured day. */
  saving: { minutesPerDay: number; usdPerMonth: number; measuredDays: number } | null
  mergedAt: string | null
  closedAt: string | null
  createdAt: string
  finishedAt: string | null
}

export function toCostFixView(row: CostFixJobRow): CostFixJobView {
  return {
    id: row.id,
    projectId: row.project_id,
    repo: row.repo,
    workflowPath: row.workflow_path,
    workflowName: row.workflow_name,
    kind: row.kind,
    status: row.status,
    summary: row.summary,
    errorCode: row.error_code,
    error: row.error,
    prUrl: row.pr_url,
    prNumber: row.pr_number,
    branch: row.branch,
    monthSavingUsd: row.month_saving_usd == null ? null : Number(row.month_saving_usd),
    baseline: row.baseline,
    measured: row.measured,
    saving: savingOf(row.baseline, row.measured),
    mergedAt: row.merged_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }
}

export function savingOf(baseline: MinutesSeries | null, measured: MinutesSeries | null): CostFixJobView['saving'] {
  if (!baseline || !measured || baseline.days <= 0 || measured.days <= 0) return null
  const perDay = (s: MinutesSeries) => ({ min: s.minutes / s.days, usd: s.usd / s.days })
  const b = perDay(baseline)
  const m = perDay(measured)
  return {
    minutesPerDay: round2(b.min - m.min),
    usdPerMonth: round2((b.usd - m.usd) * 30),
    measuredDays: measured.days,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─────────────────────────────────────────────────────────────────────────────
// Minutes per day (pure)
// ─────────────────────────────────────────────────────────────────────────────

export interface CostFixCiJobRow {
  repo: string
  workflow_name: string | null
  status: string
  started_at: string | null
  gh_created_at: string
  duration_seconds: number | null
  runner_kind: string | null
  runner_labels: string[] | null
  runner_name: string | null
  runner_group_name: string | null
}

export const COST_FIX_CI_JOB_COLUMNS =
  'repo, workflow_name, status, started_at, gh_created_at, duration_seconds, runner_kind, runner_labels, runner_name, runner_group_name'

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Billed minutes per UTC day in [from, to) for one repo's workflow. Every day
 * of the window has an entry (a day with no runs is 0). Self-hosted jobs and
 * jobs that never started bill nothing.
 */
export function minutesPerDay(rows: readonly CostFixCiJobRow[], from: Date, to: Date, complete: boolean): MinutesSeries {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const days: MinutesDay[] = []
  for (let t = start; t < to.getTime(); t += DAY_MS) days.push({ day: isoDay(t), minutes: 0, usd: 0, jobs: 0 })
  const byDay = new Map(days.map((d) => [d.day, d]))
  for (const r of rows) {
    const created = Date.parse(r.gh_created_at)
    if (!(created >= from.getTime() && created < to.getTime())) continue
    if (r.status !== 'completed' || !r.started_at) continue
    const hosted = r.runner_kind === 'github_hosted' ||
      (r.runner_kind !== 'self_hosted' && runnerKindOf({ labels: r.runner_labels ?? [], runner_name: r.runner_name, runner_group_name: r.runner_group_name }) === 'github_hosted')
    if (!hosted) continue
    const d = byDay.get(isoDay(created))
    if (!d) continue
    const minutes = billedMinutesOf(r.duration_seconds)
    d.minutes += minutes
    d.usd += minutes * usdPerMinuteFor({ labels: r.runner_labels ?? [], runner_name: r.runner_name })
    d.jobs++
  }
  for (const d of days) d.usd = Math.round(d.usd * 10_000) / 10_000
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    days: days.length,
    complete,
    minutes: days.reduce((s, d) => s + d.minutes, 0),
    // Four decimals: a quiet workflow costs fractions of a cent a day.
    usd: Math.round(days.reduce((s, d) => s + d.usd, 0) * 10_000) / 10_000,
    jobs: days.reduce((s, d) => s + d.jobs, 0),
    perDay: days,
  }
}

/** The name GitHub gives the workflow's runs: its `name:`, else its path. */
export function workflowNameOf(yaml: string, path: string): string {
  try {
    const name = parseDocument(yaml).get('name', true)
    if (isScalar(name) && typeof name.value === 'string' && name.value.trim()) return name.value.trim()
  } catch {
    // the path below
  }
  return path
}

async function loadWorkflowMinutes(
  db: SupabaseClient,
  job: Pick<CostFixJobRow, 'project_id' | 'repo' | 'workflow_name' | 'workflow_path'>,
  from: Date,
  to: Date,
  complete: boolean,
): Promise<MinutesSeries | null> {
  const names = [...new Set([job.workflow_name ?? job.workflow_path, job.workflow_path])]
  const repo = job.repo.toLowerCase()
  const rows: CostFixCiJobRow[] = []
  // PostgREST caps each response (max_rows, 1,000 on Supabase), and 14 days
  // of a busy repo's jobs are more: read on from wherever the last page
  // ended until a page comes back empty, so a lower cap is read in full too.
  let start = 0
  for (let page = 0; page < CI_JOB_MAX_PAGES; page++) {
    const { data, error } = await db
      .from('ci_jobs')
      .select(COST_FIX_CI_JOB_COLUMNS)
      .eq('project_id', job.project_id)
      .in('workflow_name', names)
      .gte('gh_created_at', from.toISOString())
      .lt('gh_created_at', to.toISOString())
      .order('gh_created_at', { ascending: true })
      .order('job_id', { ascending: true })
      .range(start, start + CI_JOB_PAGE - 1)
    if (error) {
      log.warn('ci_jobs read failed', { err: error.message })
      return null
    }
    const got = (data ?? []) as CostFixCiJobRow[]
    if (got.length === 0) return minutesPerDay(rows, from, to, complete)
    for (const r of got) if (r.repo.toLowerCase() === repo) rows.push(r)
    start += got.length
  }
  // More jobs than the cap: a total that is too low would read as a saving.
  log.warn('ci_jobs over the read cap; minutes not stored', { repo: job.repo, workflow: job.workflow_path })
  return null
}

/** Rows asked for per request (Supabase's max_rows), and requests per window (about 20,000 jobs). */
const CI_JOB_PAGE = 1_000
const CI_JOB_MAX_PAGES = 21

// ─────────────────────────────────────────────────────────────────────────────
// The PR
// ─────────────────────────────────────────────────────────────────────────────

const KIND_TITLE: Record<CiCostFixKind, string> = {
  add_concurrency: 'cancel superseded runs',
  skip_drafts: 'skip drafts',
  weekly_cron: 'run the schedule weekly',
  ignore_docs_paths: 'skip docs-only changes',
}

const KIND_WHY: Record<CiCostFixKind, string> = {
  add_concurrency:
    'Without a concurrency group, every push to a pull request starts a new run while the old one keeps going and keeps billing. Now the new push cancels the run it replaces. Pushes to your branches (the default branch included) always finish.',
  skip_drafts:
    'Coding agents open draft pull requests and push to them many times. Each push ran this workflow before anyone could merge it. Now drafts run nothing, and the workflow runs when the pull request is marked ready for review. A job whose check your branch requires keeps running on drafts and fails at its first step, "Draft PRs run no CI", because a skipped required check reads as passing and a draft must never merge untested.',
  weekly_cron:
    'This schedule ran more often than once a week, whether or not anything changed. It now runs once a week; the old schedule is above, so you can put it back if something depends on it.',
  ignore_docs_paths:
    'A pull request or push that only changes Markdown files or `docs/` ran every job here. Now it skips this workflow.',
}

export function costFixPrTitle(kind: CiCostFixKind, workflowPath: string): string {
  const file = workflowPath.split('/').pop() ?? workflowPath
  return `ci: ${KIND_TITLE[kind]} in ${file} to save Actions minutes`
}

export function costFixPrBody(input: {
  kind: CiCostFixKind
  workflowPath: string
  summary: string
  evidence: string | null
  monthSavingUsd: number | null
  baseline: MinutesSeries | null
}): string {
  const lines = [
    `Mushi CI cost fix for \`${input.workflowPath}\`.`,
    '',
    '### What changed',
    input.summary,
    '',
    '### Why',
    KIND_WHY[input.kind],
  ]
  if (input.evidence) lines.push('', '### What Mushi saw', input.evidence.slice(0, 2000))
  if (input.baseline && input.baseline.jobs > 0) {
    lines.push(
      '',
      `Over the last ${input.baseline.days} days this workflow used about ${input.baseline.minutes} billed minutes on GitHub-hosted runners ($${input.baseline.usd.toFixed(2)}, estimated from job times).`,
    )
  }
  if (input.monthSavingUsd != null && input.monthSavingUsd > 0) {
    lines.push('', `**Estimated saving:** about $${input.monthSavingUsd.toFixed(2)} a month.`)
  }
  lines.push(
    '',
    'This is a draft: review the change, mark it ready and merge it when it looks right. After it merges, Mushi measures this workflow\'s minutes per day for 14 days and shows the saving that actually happened next to the advice.',
  )
  return lines.join('\n')
}

function costFixBranch(kind: CiCostFixKind, now: Date): string {
  return `mushi/ci-cost-${kind.replace(/_/g, '-')}-${now.toISOString().slice(0, 10)}-${now.getTime().toString(36)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Repo, token, GitHub reads
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectRepo {
  ref: GithubRepoRef
  defaultBranch: string | null
  installationId: number | null
}

/** The project's connected repo named `owner/name` (case-insensitive); null when it is not one of the project's. */
export async function findProjectRepo(db: SupabaseClient, projectId: string, repo: string): Promise<ProjectRepo | null> {
  const want = repo.toLowerCase()
  const { data } = await db
    .from('project_repos')
    .select('repo_url, default_branch, github_app_installation_id')
    .eq('project_id', projectId)
    .limit(50)
  for (const r of (data ?? []) as Array<{ repo_url: string | null; default_branch: string | null; github_app_installation_id: unknown }>) {
    const ref = parseGithubRepoUrl(r.repo_url ?? '')
    if (ref && `${ref.owner}/${ref.repo}`.toLowerCase() === want) {
      const inst = Number(r.github_app_installation_id)
      return { ref, defaultBranch: r.default_branch ?? null, installationId: Number.isFinite(inst) && inst > 0 ? inst : null }
    }
  }
  const { data: settings } = await db.from('project_settings').select('github_repo_url').eq('project_id', projectId).maybeSingle()
  const legacy = parseGithubRepoUrl((settings as { github_repo_url?: string | null } | null)?.github_repo_url ?? '')
  if (legacy && `${legacy.owner}/${legacy.repo}`.toLowerCase() === want) return { ref: legacy, defaultBranch: null, installationId: null }
  return null
}

/**
 * Status check names the branch requires: rulesets (`GET /rules/branches`)
 * plus classic branch protection (`GET /branches/{b}`). Null when either read
 * fails, or the branch is protected but its required checks are not visible:
 * the transforms then refuse instead of guessing.
 */
export async function fetchRequiredChecks(token: string, ref: GithubRepoRef, branch: string): Promise<string[] | null> {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`
  const out = new Set<string>()
  try {
    const rulesRes = await fetchWithTimeout(`${base}/rules/branches/${encodeURIComponent(branch)}`, { headers }, 10_000)
    if (!rulesRes.ok) return null
    const rules = (await rulesRes.json()) as Array<{ type?: string; parameters?: { required_status_checks?: Array<{ context?: string }> } }>
    if (!Array.isArray(rules)) return null
    for (const r of rules) {
      if (r.type !== 'required_status_checks') continue
      for (const c of r.parameters?.required_status_checks ?? []) if (c.context) out.add(c.context)
    }
    const branchRes = await fetchWithTimeout(`${base}/branches/${encodeURIComponent(branch)}`, { headers }, 10_000)
    if (!branchRes.ok) return null
    const b = (await branchRes.json()) as {
      protected?: boolean
      protection?: { required_status_checks?: { contexts?: string[]; checks?: Array<{ context?: string }> } }
    }
    if (b.protected && !b.protection) return null
    for (const c of b.protection?.required_status_checks?.contexts ?? []) out.add(c)
    for (const c of b.protection?.required_status_checks?.checks ?? []) if (c.context) out.add(c.context)
    return [...out]
  } catch {
    return null
  }
}

export interface CostFixDeps {
  now: () => Date
  resolveToken: (db: SupabaseClient, projectId: string, installationId: number | null) => Promise<string | null>
  /** The default branch and its tip (stored name first, then GitHub's). */
  baseBranch: (token: string, ref: GithubRepoRef, stored: string | null) => Promise<{ branch: string; sha: string }>
  readFile: (token: string, ref: GithubRepoRef, branch: string, path: string) => Promise<BaseFileState>
  /** Null when they could not be read (the transforms that need them refuse). */
  requiredChecks: (token: string, ref: GithubRepoRef, branch: string) => Promise<string[] | null>
  createPr: (opts: Parameters<typeof createPrFromFiles>[0]) => Promise<PrResult>
  fetchPr: (token: string, ref: GithubRepoRef, n: number) => Promise<PullRequestSnapshot | null>
}

export const defaultCostFixDeps: CostFixDeps = {
  now: () => new Date(),
  resolveToken: (db, projectId, installationId) => resolveProjectGithubToken(db as never, projectId, installationId),
  baseBranch: (token, ref, stored) => resolveBaseBranch(token, ref.owner, ref.repo, stored ?? 'main'),
  readFile: (token, ref, branch, path) => fetchBaseFileState(token, ref.owner, ref.repo, branch, path),
  requiredChecks: fetchRequiredChecks,
  createPr: (opts) => createPrFromFiles(opts),
  fetchPr: fetchPullRequest,
}

// ─────────────────────────────────────────────────────────────────────────────
// Run one job
// ─────────────────────────────────────────────────────────────────────────────

export type CostFixRunResult =
  | { ok: true; status: 'pr_opened'; prUrl: string }
  | { ok: true; status: 'no_change' | 'refused'; summary: string }
  | { ok: false; status: 'failed'; code: string; error: string }
  | { ok: false; status: 'skipped'; error: string }

/** Plain-words errors the console shows as they are. */
export const COST_FIX_ERRORS = {
  NO_REPO: 'This repository is no longer connected to the project.',
  GITHUB_NOT_CONNECTED: 'Mushi has no GitHub access to this repository. Connect GitHub (App or token) for the project first.',
  WORKFLOW_NOT_FOUND: 'The workflow file is not on the default branch any more. Refresh the CI page; the advice may be out of date.',
  WORKFLOW_UNREADABLE: 'Mushi could not read the workflow file from GitHub.',
  GITHUB_WORKFLOWS_WRITE_MISSING:
    'The GitHub access Mushi uses cannot change workflow files. Give the GitHub App "Workflows: Read and write" (or use a token with the workflow scope), or make the change yourself from the advice.',
  GITHUB_ERROR: 'GitHub did not open the pull request. Try again in a few minutes.',
} as const
export type CostFixErrorCode = keyof typeof COST_FIX_ERRORS

export async function runCiCostFixJob(db: SupabaseClient, jobId: string, deps: CostFixDeps = defaultCostFixDeps): Promise<CostFixRunResult> {
  const now = deps.now()
  const nowIso = now.toISOString()
  const staleIso = new Date(now.getTime() - COST_FIX_STALE_MS).toISOString()
  // Claim a queued job, else one a dead run left `running`. Each update is
  // guarded on the status it read, so two workers never both claim a job.
  const claim = (stale: boolean) => {
    const q = db.from('ci_cost_fix_jobs').update({ status: 'running', started_at: nowIso, updated_at: nowIso }).eq('id', jobId)
    return (stale ? q.eq('status', 'running').lte('started_at', staleIso) : q.eq('status', 'queued')).select(COST_FIX_JOB_COLUMNS)
  }
  let { data: claimed, error: claimErr } = await claim(false)
  if (!claimErr && (claimed ?? []).length === 0) ({ data: claimed, error: claimErr } = await claim(true))
  if (claimErr) return { ok: false, status: 'skipped', error: claimErr.message }
  const job = ((claimed ?? []) as CostFixJobRow[])[0]
  if (!job) return { ok: false, status: 'skipped', error: 'Job is not queued (already running or finished).' }

  const finish = async (status: CostFixStatus, patch: Record<string, unknown>) => {
    const at = deps.now().toISOString()
    const { error } = await db
      .from('ci_cost_fix_jobs')
      .update({ status, ...patch, finished_at: at, updated_at: at })
      .eq('id', job.id)
      .eq('status', 'running')
    if (error) log.warn('ci_cost_fix_jobs finish failed', { jobId: job.id, err: error.message })
  }
  const fail = async (code: CostFixErrorCode, detail?: string): Promise<CostFixRunResult> => {
    await finish('failed', { error_code: code, error: COST_FIX_ERRORS[code] })
    if (detail) log.warn('ci cost fix failed', { jobId: job.id, code, detail: detail.slice(0, 300) })
    return { ok: false, status: 'failed', code, error: COST_FIX_ERRORS[code] }
  }

  if (!isCiCostFixKind(job.kind)) return fail('GITHUB_ERROR', `unknown kind ${String(job.kind)}`)
  try {
    const repo = await findProjectRepo(db, job.project_id, job.repo)
    if (!repo) return await fail('NO_REPO')
    const token = await deps.resolveToken(db, job.project_id, repo.installationId)
    if (!token) return await fail('GITHUB_NOT_CONNECTED')
    let base: { branch: string; sha: string }
    try {
      base = await deps.baseBranch(token, repo.ref, repo.defaultBranch)
    } catch (err) {
      return await fail('WORKFLOW_UNREADABLE', String(err))
    }
    const file = await deps.readFile(token, repo.ref, base.branch, job.workflow_path)
    if (file.kind === 'absent') return await fail('WORKFLOW_NOT_FOUND')
    if (file.kind !== 'exists') return await fail('WORKFLOW_UNREADABLE', file.detail)

    const workflowName = workflowNameOf(file.contents, job.workflow_path)
    // Which jobs must keep reporting: skip_drafts and ignore_docs_paths refuse without the list.
    const needsChecks = job.kind === 'skip_drafts' || job.kind === 'ignore_docs_paths'
    const requiredChecks = needsChecks ? await deps.requiredChecks(token, repo.ref, base.branch).catch(() => null) : null
    const result = applyCiCostFix(job.kind, file.contents, { requiredChecks, workflowPath: job.workflow_path })
    if (result.refused) {
      await finish('refused', { workflow_name: workflowName, summary: result.summary, error_code: 'TRANSFORM_REFUSED', error: result.refused })
      return { ok: true, status: 'refused', summary: result.summary }
    }
    if (!result.changed) {
      await finish('no_change', { workflow_name: workflowName, summary: `Already applied: ${result.summary}` })
      return { ok: true, status: 'no_change', summary: result.summary }
    }

    const baseline = await loadWorkflowMinutes(
      db,
      { ...job, workflow_name: workflowName },
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - BASELINE_DAYS * DAY_MS),
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
      true,
    )
    const title = costFixPrTitle(job.kind, job.workflow_path)
    let pr: PrResult
    try {
      pr = await deps.createPr({
        token,
        owner: repo.ref.owner,
        repo: repo.ref.repo,
        defaultBranch: base.branch,
        baseSha: base.sha,
        branch: costFixBranch(job.kind, now),
        title,
        body: costFixPrBody({
          kind: job.kind,
          workflowPath: job.workflow_path,
          summary: result.summary,
          evidence: job.evidence,
          monthSavingUsd: job.month_saving_usd == null ? null : Number(job.month_saving_usd),
          baseline,
        }),
        files: [{ path: job.workflow_path, contents: result.yaml, reason: title.replace(/^ci: /, '') }],
        labels: COST_FIX_PR_LABELS,
        // Commit type `ci`, so host commitlint accepts it.
        category: 'ci',
        // A draft: CI runs when a person marks it ready (ADR 0047).
        markReady: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // GitHub refuses writes under .github/workflows without the workflows permission.
      if (/→ (403|404)/.test(message)) return await fail('GITHUB_WORKFLOWS_WRITE_MISSING', message)
      return await fail('GITHUB_ERROR', message)
    }
    await finish('pr_opened', {
      workflow_name: workflowName,
      summary: result.summary,
      baseline,
      pr_url: pr.url,
      pr_number: pr.number,
      branch: pr.branch,
      commit_sha: pr.commitSha,
      error_code: null,
      error: null,
    })
    return { ok: true, status: 'pr_opened', prUrl: pr.url }
  } catch (err) {
    return await fail('GITHUB_ERROR', err instanceof Error ? err.message : String(err))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// After the merge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For an opened PR: notice the merge (or close) on GitHub, then measure the
 * workflow's minutes per day since the merge (whole days, up to 14) and store
 * them. Returns the row as stored afterwards. Never throws; a failed GitHub or
 * DB read returns the row unchanged.
 */
export async function refreshCostFixMeasurement(
  db: SupabaseClient,
  job: CostFixJobRow,
  deps: Pick<CostFixDeps, 'now' | 'resolveToken' | 'fetchPr'> = defaultCostFixDeps,
): Promise<CostFixJobRow> {
  if (job.status !== 'pr_opened' || job.closed_at) return job
  if (job.measured?.complete) return job
  const now = deps.now()
  const patch: Record<string, unknown> = {}
  let mergedAt = job.merged_at
  try {
    if (!mergedAt && job.pr_number) {
      const repo = await findProjectRepo(db, job.project_id, job.repo)
      const token = repo ? await deps.resolveToken(db, job.project_id, repo.installationId) : null
      const pr = token && repo ? await deps.fetchPr(token, repo.ref, job.pr_number) : null
      if (pr?.merged) {
        mergedAt = pr.mergedAt ?? now.toISOString()
        patch.merged_at = mergedAt
      } else if (pr && pr.state === 'closed') {
        patch.closed_at = pr.closedAt ?? now.toISOString()
      }
    }
    if (mergedAt) {
      // Whole UTC days after the merge day, up to MEASURE_DAYS.
      const m = new Date(mergedAt)
      const from = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate()) + DAY_MS)
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      const end = Math.min(today, from.getTime() + MEASURE_DAYS * DAY_MS)
      if (end > from.getTime()) {
        const measured = await loadWorkflowMinutes(db, job, from, new Date(end), end >= from.getTime() + MEASURE_DAYS * DAY_MS)
        if (measured) patch.measured = measured
      }
    }
    if (Object.keys(patch).length === 0) return job
    patch.updated_at = now.toISOString()
    const { error } = await db.from('ci_cost_fix_jobs').update(patch).eq('id', job.id)
    if (error) {
      log.warn('ci_cost_fix_jobs measurement save failed', { jobId: job.id, err: error.message })
      return job
    }
    return { ...job, ...(patch as Partial<CostFixJobRow>) }
  } catch (err) {
    log.warn('ci cost fix measurement failed', { jobId: job.id, err: err instanceof Error ? err.message : String(err) })
    return job
  }
}
