/**
 * FILE: packages/server/supabase/functions/_shared/ci-overview.ts
 * PURPOSE: Build GET /v1/admin/ci/overview (Plan 022 Phase 4) from the
 *          stored CI data of the projects the caller can read: hosts →
 *          runners → repos → live jobs, stats and advice.
 *
 *   loadCiOverviewRows — the reads (one query per table, scoped by project
 *                        or by the projects' organizations)
 *   buildCiOverview    — pure: rows → CiOverview (ci-overview-types.ts)
 *
 * Jobs: every queued / running job in the window first, never cut off, then
 * the newest finished jobs, up to 200 in total. Stats read at most 1,000
 * finished jobs (PostgREST max_rows), newest first.
 */

import { adviseCi, percentile, slowSteps, STALE_HEARTBEAT_MS, type AdvisorJob } from './ci-advisor.ts'
import { runnerBaseName, runnerNameMatches } from './ci-infra.ts'
import type { CiJobKind, CiOverview } from './ci-overview-types.ts'
import type { RepoPermissions } from './ci-collector.ts'

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any }

export const OVERVIEW_JOB_LIMIT = 200
const FINISHED_READ_LIMIT = 1000

export interface JobRow {
  id: string
  project_id: string
  repo: string
  run_id: number
  run_attempt: number
  job_id: number
  workflow_name: string | null
  job_name: string
  head_branch: string | null
  pr_number: number | null
  status: string
  conclusion: string | null
  ci_kind: CiJobKind
  infra: boolean
  infra_detail: string | null
  runner_name: string | null
  runner_kind: 'self_hosted' | 'github_hosted' | 'unknown'
  runner_labels: string[] | null
  queue_seconds: number | null
  duration_seconds: number | null
  gh_created_at: string
  started_at: string | null
  completed_at: string | null
  html_url: string | null
  steps: Array<{ name: string; conclusion: string | null; seconds: number | null }> | null
}

export interface RunnerRow {
  project_id: string
  repo: string
  runner_name: string
  status: 'online' | 'offline' | 'unknown'
  busy: boolean | null
  labels: string[] | null
  kind: 'self_hosted' | 'github_hosted' | 'unknown'
  first_seen_at: string | null
  last_job_at: string | null
}

export interface HostRow {
  organization_id: string
  project_id: string | null
  host_id: string
  hostname: string
  platform: 'linux' | 'wsl2' | 'macos' | 'windows'
  cpu_count: number | null
  mem_total_mb: number | null
  last_heartbeat_at: string
  metrics: Record<string, unknown> | null
  runners: Array<Record<string, unknown>> | null
  mushi_version: string | null
}

export interface SampleRow {
  host_id: string
  runner_name: string
  repo: string
  run_id: number
  run_attempt: number
  phase: 'started' | 'completed'
  at: string
  mem_peak_mb: number | null
  mem_max_mb: number | null
  oom_kills: number | null
}

export interface OverviewRows {
  projects: Array<{ id: string; name: string | null; organization_id: string | null }>
  repoBindings: Array<{ project_id: string; repo: string }>
  unfinished: JobRow[]
  finished: JobRow[]
  runners: RunnerRow[]
  hosts: HostRow[]
  samples: SampleRow[]
  permissions: Record<string, RepoPermissions>
  /** The newest overview live sync of these projects (ci_collector_state.last_live_sync_at). */
  lastLiveSyncAt: string | null
  workflows: Array<{ projectId: string; repo: string; path: string; text: string }>
}

const JOB_COLUMNS =
  'id, project_id, repo, run_id, run_attempt, job_id, workflow_name, job_name, head_branch, pr_number, status, conclusion, ci_kind, infra, infra_detail, runner_name, runner_kind, runner_labels, queue_seconds, duration_seconds, gh_created_at, started_at, completed_at, html_url, steps'

function repoOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

/** Every read the overview needs. A failed read throws: the route answers 500, never an empty CI view. */
export async function loadCiOverviewRows(db: Db, projectIds: string[], from: Date): Promise<OverviewRows> {
  const fromIso = from.toISOString()
  const check = <T>(res: { data: unknown; error: { message?: string } | null }, what: string): T[] => {
    if (res.error) throw new Error(`${what} read failed: ${res.error.message ?? 'unknown error'}`)
    return (res.data ?? []) as T[]
  }
  const [projectsRes, reposRes, unfinishedRes, finishedRes, runnersRes, stateRes, snapsRes] = await Promise.all([
    db.from('projects').select('id, name, organization_id').in('id', projectIds),
    db.from('project_repos').select('project_id, repo_url').in('project_id', projectIds),
    db.from('ci_jobs').select(JOB_COLUMNS).in('project_id', projectIds).neq('status', 'completed').gte('gh_created_at', fromIso).order('gh_created_at', { ascending: false }).limit(FINISHED_READ_LIMIT),
    db.from('ci_jobs').select(JOB_COLUMNS).in('project_id', projectIds).eq('status', 'completed').gte('gh_created_at', fromIso).order('gh_created_at', { ascending: false }).limit(FINISHED_READ_LIMIT),
    db.from('ci_runners').select('project_id, repo, runner_name, status, busy, labels, kind, first_seen_at, last_job_at').in('project_id', projectIds),
    db.from('ci_collector_state').select('project_id, permissions, last_live_sync_at').in('project_id', projectIds),
    db.from('connector_snapshots').select('project_id, snapshot').in('project_id', projectIds).eq('kind', 'github').eq('is_current', true).eq('ok', true),
  ])
  const projects = check<OverviewRows['projects'][number]>(projectsRes, 'projects')
  const orgIds = [...new Set(projects.map((p) => p.organization_id).filter((x): x is string => !!x))]
  const [hostsRes, samplesRes] = orgIds.length
    ? await Promise.all([
        db.from('ci_runner_hosts').select('organization_id, project_id, host_id, hostname, platform, cpu_count, mem_total_mb, last_heartbeat_at, metrics, runners, mushi_version').in('organization_id', orgIds),
        db.from('ci_runner_job_samples').select('host_id, runner_name, repo, run_id, run_attempt, phase, at, mem_peak_mb, mem_max_mb, oom_kills').in('organization_id', orgIds).gte('at', fromIso).order('at', { ascending: false }).limit(FINISHED_READ_LIMIT),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]

  const permissions: Record<string, RepoPermissions> = {}
  let lastLiveSyncAt: string | null = null
  for (const s of check<{ permissions: Record<string, RepoPermissions> | null; last_live_sync_at: string | null }>(stateRes, 'ci_collector_state')) {
    Object.assign(permissions, s.permissions ?? {})
    if (s.last_live_sync_at && (!lastLiveSyncAt || s.last_live_sync_at > lastLiveSyncAt)) lastLiveSyncAt = s.last_live_sync_at
  }

  const workflows: OverviewRows['workflows'] = []
  // A missing GitHub connector snapshot only silences the workflow rules.
  for (const s of (snapsRes.error ? [] : (snapsRes.data ?? [])) as Array<{ project_id: string; snapshot: { facts?: { workflowFiles?: Record<string, string> }; resources?: Array<{ kind?: string; externalId?: string }> } | null }>) {
    const repo = s.snapshot?.resources?.find((r) => r.kind === 'repo')?.externalId ?? null
    if (!repo) continue
    for (const [path, text] of Object.entries(s.snapshot?.facts?.workflowFiles ?? {})) {
      if (typeof text === 'string') workflows.push({ projectId: s.project_id, repo, path, text })
    }
  }

  return {
    projects,
    repoBindings: check<{ project_id: string; repo_url: string }>(reposRes, 'project_repos')
      .map((r) => ({ project_id: r.project_id, repo: repoOf(r.repo_url) }))
      .filter((r): r is { project_id: string; repo: string } => !!r.repo),
    unfinished: check<JobRow>(unfinishedRes, 'ci_jobs'),
    finished: check<JobRow>(finishedRes, 'ci_jobs'),
    runners: check<RunnerRow>(runnersRes, 'ci_runners'),
    hosts: check<HostRow>(hostsRes, 'ci_runner_hosts'),
    samples: check<SampleRow>(samplesRes, 'ci_runner_job_samples'),
    permissions,
    lastLiveSyncAt,
    workflows,
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const UNFINISHED_QUEUED = new Set(['queued', 'waiting', 'requested', 'pending'])
const COUNTED = new Set(['passed', 'code_failure', 'runner_lost', 'queue_expired'])

/** Pass rate over jobs that ran to a verdict: superseded cancels and skips do not count either way. */
function passRate(jobs: readonly JobRow[]): number | null {
  const counted = jobs.filter((j) => COUNTED.has(j.ci_kind))
  if (counted.length === 0) return null
  return Math.round((counted.filter((j) => j.ci_kind === 'passed').length / counted.length) * 1000) / 1000
}

function nums(jobs: readonly JobRow[], key: 'queue_seconds' | 'duration_seconds'): number[] {
  return jobs.map((j) => j[key]).filter((x): x is number => typeof x === 'number')
}

function aggregatePermission(values: Array<'ok' | 'missing' | 'unknown' | undefined>): 'ok' | 'missing' | 'unknown' {
  if (values.includes('missing')) return 'missing'
  if (values.includes('ok')) return 'ok'
  return 'unknown'
}

export function buildCiOverview(rows: OverviewRows, opts: { now: Date; days: number; from: Date; refreshedAt: string | null }): CiOverview {
  const { now } = opts
  const nowMs = now.getTime()
  const all = [...rows.unfinished, ...rows.finished]
  const projectName = new Map(rows.projects.map((p) => [p.id, p.name ?? p.id.slice(0, 8)]))
  const scopedRepos = new Set([...rows.repoBindings.map((r) => r.repo), ...all.map((j) => j.repo), ...rows.runners.map((r) => r.repo)])
  const projectIds = new Set(rows.projects.map((p) => p.id))

  // Hosts and samples are read per organization, but a member of one project
  // must not see another project's repos or memory figures on a shared
  // machine. A host shows when it pushed with one of these projects' keys or
  // runs one of these repos; only the runner entries of these repos show
  // (an entry with no repo only when the host is this project's); samples
  // only for these repos. A runner name is not proof: names repeat.
  const hostInScope = (h: HostRow) => Boolean(h.project_id && projectIds.has(h.project_id))
  const runnerEntryInScope = (h: HostRow, r: Record<string, unknown>) => {
    const repo = str(r.repo)
    return repo ? scopedRepos.has(repo) : hostInScope(h)
  }
  const scopedSamples = rows.samples.filter((s) => scopedRepos.has(s.repo))

  const hosts = rows.hosts
    .filter((h) => hostInScope(h) || (h.runners ?? []).some((r) => {
      const repo = str(r.repo)
      return repo != null && scopedRepos.has(repo)
    }))
    .map((h) => ({ ...h, runners: (h.runners ?? []).filter((r) => runnerEntryInScope(h, r)) }))
    .map((h) => {
      const m = h.metrics ?? {}
      return {
        hostId: h.host_id,
        hostname: h.hostname,
        platform: h.platform,
        cpuCount: h.cpu_count,
        memTotalMb: h.mem_total_mb,
        lastHeartbeatAt: h.last_heartbeat_at,
        stale: nowMs - Date.parse(h.last_heartbeat_at) > STALE_HEARTBEAT_MS,
        mushiVersion: h.mushi_version,
        metrics: Object.fromEntries(
          ([['load1', 'load1'], ['memUsedMb', 'mem_used_mb'], ['swapUsedMb', 'swap_used_mb'], ['swapTotalMb', 'swap_total_mb'], ['diskFreeGb', 'disk_free_gb']] as const)
            .map(([to, fromKey]) => [to, num(m[fromKey])])
            .filter(([, v]) => v != null),
        ) as CiOverview['hosts'][number]['metrics'],
        runners: (h.runners ?? []).map((r) => ({
          name: String(r.name ?? ''),
          repo: str(r.repo),
          service: str(r.service),
          active: r.active === true,
          restarts: num(r.restarts),
          memCurrentMb: num(r.mem_current_mb),
          memMaxMb: num(r.mem_max_mb),
          oomKills: num(r.oom_kills),
        })),
      }
    })
  const hostOfRunner = (name: string, repo: string): string | null => {
    const exact = hosts.find((h) => h.runners.some((r) => runnerNameMatches(r.name, name) && (!r.repo || r.repo === repo)))
    return exact?.hostId ?? null
  }

  const dayAgo = nowMs - 24 * 60 * 60_000
  const weekAgo = nowMs - 7 * 24 * 60 * 60_000
  // One-job runners (`<label>-<unix seconds>`) fold into one runner per label.
  const grouped = new Map<string, typeof rows.runners>()
  for (const r of rows.runners) {
    const key = `${r.project_id}|${r.repo}|${runnerBaseName(r.runner_name)}`
    grouped.set(key, [...(grouped.get(key) ?? []), r])
  }
  const runners = [...grouped.values()].map((group) => {
    const r = group[0]
    const name = runnerBaseName(r.runner_name)
    const mine = all.filter((j) => j.repo === r.repo && j.project_id === r.project_id && j.runner_name != null && runnerBaseName(j.runner_name) === name)
    const status = group.some((g) => g.status === 'online') ? 'online' : group.some((g) => g.status === 'offline') ? 'offline' : r.status
    const lastJobAt = group.map((g) => g.last_job_at).filter((x): x is string => !!x).sort().at(-1) ?? null
    return {
      projectId: r.project_id,
      repo: r.repo,
      name,
      status,
      busy: group.some((g) => g.busy === true) ? true : group.every((g) => g.busy === false) ? false : null,
      labels: [...new Set(group.flatMap((g) => g.labels ?? []))],
      kind: r.kind,
      hostId: hostOfRunner(name, r.repo),
      lastJobAt,
      jobs24h: mine.filter((j) => Date.parse(j.gh_created_at) >= dayAgo).length,
      infraFailures7d: mine.filter((j) => j.infra && Date.parse(j.gh_created_at) >= weekAgo).length,
    }
  })

  const repoKeys = new Map<string, { projectId: string; repo: string }>()
  for (const b of rows.repoBindings) repoKeys.set(`${b.project_id}|${b.repo}`, { projectId: b.project_id, repo: b.repo })
  for (const j of all) repoKeys.set(`${j.project_id}|${j.repo}`, { projectId: j.project_id, repo: j.repo })
  const repos = [...repoKeys.values()].map(({ projectId, repo }) => {
    const jobs = all.filter((j) => j.project_id === projectId && j.repo === repo)
    return {
      projectId,
      projectName: projectName.get(projectId) ?? projectId.slice(0, 8),
      repo,
      queued: jobs.filter((j) => UNFINISHED_QUEUED.has(j.status)).length,
      running: jobs.filter((j) => j.status === 'in_progress').length,
      jobs7d: jobs.length,
      passRate: passRate(jobs),
      queueP95s: percentile(nums(jobs, 'queue_seconds'), 95),
      durationP50s: percentile(nums(jobs.filter((j) => j.status === 'completed'), 'duration_seconds'), 50),
    }
  })

  const peakOf = new Map<string, number>()
  for (const s of scopedSamples) {
    if (s.phase !== 'completed' || s.mem_peak_mb == null) continue
    peakOf.set(`${s.repo}|${s.run_id}|${s.run_attempt}|${s.runner_name}`, s.mem_peak_mb)
  }
  const shown = [...rows.unfinished, ...rows.finished.slice(0, Math.max(0, OVERVIEW_JOB_LIMIT - rows.unfinished.length))]
  const jobs = shown.map((j) => ({
    id: j.id,
    projectId: j.project_id,
    repo: j.repo,
    runId: Number(j.run_id),
    jobId: Number(j.job_id),
    workflowName: j.workflow_name,
    jobName: j.job_name,
    headBranch: j.head_branch,
    prNumber: j.pr_number,
    status: j.status,
    conclusion: j.conclusion,
    ciKind: j.ci_kind,
    infra: j.infra,
    infraDetail: j.infra_detail,
    runnerName: j.runner_name,
    runnerKind: j.runner_kind,
    labels: j.runner_labels ?? [],
    queueSeconds: j.queue_seconds,
    durationSeconds: j.duration_seconds,
    createdAt: j.gh_created_at,
    startedAt: j.started_at,
    completedAt: j.completed_at,
    htmlUrl: j.html_url,
    memPeakMb: j.runner_name ? peakOf.get(`${j.repo}|${j.run_id}|${j.run_attempt}|${j.runner_name}`) ?? null : null,
  }))

  const finished = rows.finished
  const byRunner = [...new Set(all.map((j) => j.runner_name).filter((x): x is string => !!x))].map((runner) => {
    const mine = all.filter((j) => j.runner_name === runner)
    return {
      runner,
      jobs: mine.length,
      busySeconds: nums(mine, 'duration_seconds').reduce((a, b) => a + b, 0),
      infraFailures: mine.filter((j) => j.infra).length,
      queueP95s: percentile(nums(mine, 'queue_seconds'), 95),
    }
  }).sort((a, b) => b.jobs - a.jobs)
  const wfKeys = new Map<string, { repo: string; workflow: string }>()
  for (const j of finished) wfKeys.set(`${j.repo}|${j.workflow_name ?? '(unnamed)'}`, { repo: j.repo, workflow: j.workflow_name ?? '(unnamed)' })
  const byWorkflow = [...wfKeys.values()].map(({ repo, workflow }) => {
    const mine = finished.filter((j) => j.repo === repo && (j.workflow_name ?? '(unnamed)') === workflow)
    const counted = mine.filter((j) => COUNTED.has(j.ci_kind))
    return {
      repo,
      workflow,
      jobs: mine.length,
      durationP50s: percentile(nums(mine, 'duration_seconds'), 50),
      durationP95s: percentile(nums(mine, 'duration_seconds'), 95),
      failRate: counted.length ? Math.round((counted.filter((j) => j.ci_kind === 'code_failure').length / counted.length) * 1000) / 1000 : null,
    }
  }).sort((a, b) => b.jobs - a.jobs)

  const advisorJobs: AdvisorJob[] = all.map((j) => ({
    repo: j.repo,
    jobName: j.job_name,
    status: j.status,
    ciKind: j.ci_kind,
    infra: j.infra,
    runnerName: j.runner_name,
    runnerKind: j.runner_kind,
    labels: j.runner_labels ?? [],
    queueSeconds: j.queue_seconds,
    durationSeconds: j.duration_seconds,
    createdAt: j.gh_created_at,
    steps: j.steps ?? [],
  }))
  const watched: Record<string, string> = {}
  for (const r of rows.runners) {
    if (!r.first_seen_at) continue
    if (!watched[r.repo] || r.first_seen_at < watched[r.repo]) watched[r.repo] = r.first_seen_at
  }
  const advice = adviseCi({
    now,
    jobs: advisorJobs,
    runners: rows.runners.map((r) => ({ repo: r.repo, name: r.runner_name, kind: r.kind, labels: r.labels ?? [], firstSeenAt: r.first_seen_at })),
    hosts: hosts.map((h) => ({
      hostId: h.hostId,
      hostname: h.hostname,
      lastHeartbeatAt: h.lastHeartbeatAt,
      metrics: { swapUsedMb: h.metrics.swapUsedMb, swapTotalMb: h.metrics.swapTotalMb },
      runners: h.runners.map((r) => ({ name: r.name, memCurrentMb: r.memCurrentMb, memMaxMb: r.memMaxMb, oomKills: r.oomKills })),
    })),
    samples: scopedSamples
      .filter((s) => s.phase === 'completed')
      .map((s) => ({ hostId: s.host_id, runnerName: s.runner_name, repo: s.repo, at: s.at, memPeakMb: s.mem_peak_mb, memMaxMb: s.mem_max_mb, oomKills: s.oom_kills })),
    workflows: rows.workflows.map((w) => ({ repo: w.repo, path: w.path, text: w.text })),
    repoWatchedSince: watched,
  })

  const permissionValues = [...scopedRepos].map((r) => rows.permissions[r])
  return {
    generatedAt: now.toISOString(),
    refreshedAt: opts.refreshedAt,
    window: { days: opts.days, from: opts.from.toISOString() },
    permissions: {
      jobs: aggregatePermission(permissionValues.map((p) => p?.jobs)),
      runners: aggregatePermission(permissionValues.map((p) => p?.runners)),
    },
    hosts,
    runners,
    repos,
    jobs,
    stats: {
      jobs: all.length,
      passRate: passRate(all),
      queueP50s: percentile(nums(all, 'queue_seconds'), 50),
      queueP95s: percentile(nums(all, 'queue_seconds'), 95),
      durationP50s: percentile(nums(finished, 'duration_seconds'), 50),
      durationP95s: percentile(nums(finished, 'duration_seconds'), 95),
      infraFailures: finished.filter((j) => j.infra).length,
      codeFailures: finished.filter((j) => j.ci_kind === 'code_failure').length,
      byRunner,
      byWorkflow,
      slowSteps: slowSteps(advisorJobs),
    },
    advice,
  }
}
