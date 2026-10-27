/**
 * FILE: packages/server/supabase/functions/_shared/ci-compare.ts
 * PURPOSE: "Choose where CI runs, see cost and speed" (Plan 022 Phase 7,
 *          ADR 0037). Builds GET /v1/admin/ci/compare (ci-compare-types.ts):
 *
 *   aggregateCiJobs   job rows → ComparisonData. The SQL function
 *                     ci_runner_comparison returns the same shape over the
 *                     whole window; this is the fallback until that
 *                     migration is applied (newest jobs only) and the tested
 *                     spec of what the SQL computes.
 *   readComparisonData  the SQL function's jsonb, read defensively.
 *   buildCiCompare    ComparisonData + visibility + settings + heartbeats +
 *                     workflow YAML → rows per repo × runner class, accounts
 *                     (included minutes per GitHub owner), physical machines
 *                     (busy-hour union), speed factors, what-ifs, the "why it
 *                     costs what it costs" facts and cost advice.
 *
 * Speed factor: only PASSED jobs that ran on both classes, at least 5 on each
 * side (MIN_SPEED_SAMPLES); the median of per-job ratios. Without that it is
 * "not measured, assuming 1.0" and says so.
 *
 * Pure: no I/O.
 */

import { runnerBaseName, runnerKindOf, runnerNameMatches, type CiRunnerKind } from './ci-infra.ts'
import { billedMinutesOf, GITHUB_RUNNER_RATES, RUNNER_PRICE_RATIO, runnerOsOf, usdPerMinuteFor, type RunnerOs } from './ci-minutes.ts'
import { adviseCiCost, percentile } from './ci-advisor.ts'
import {
  accountMonthCost,
  allocate,
  ANNOUNCED_SELF_HOSTED_FEE_USD,
  machineCost,
  machineFromSettings,
  money,
  toMonth,
  unionSeconds,
  mergeIntervals,
} from './ci-cost.ts'
import { isHostedLabel, parseRepoWorkflows, runsOnJobMatches, type ParsedWorkflow, type RunsOnJob } from './ci-runs-on.ts'
import type {
  CiCompare,
  CiCompareAccount,
  CiCompareExplain,
  CiCompareMachine,
  CiCompareRow,
  CiCompareSettings,
  CiCompareSpeed,
  CiCompareWhatIf,
  Provenance,
  RepoVisibility,
} from './ci-compare-types.ts'

export const MIN_SPEED_SAMPLES = 5
/** Under this many days of data every figure is low confidence. */
export const LOW_CONFIDENCE_DAYS = 7
/** A job this short still bills a whole minute. */
export const TINY_JOB_S = 20
export const BUSY_WARN_SHARE = 0.7
export const MAX_WHAT_IFS = 8
const DAY_MS = 24 * 60 * 60_000
const PR_EVENTS = new Set(['pull_request', 'pull_request_target'])
const COUNTED = new Set(['passed', 'code_failure', 'runner_lost', 'queue_expired'])
const INFRA = new Set(['runner_lost', 'queue_expired', 'waiting_for_runner'])

/** Which numbers are measured from GitHub's job times and which are estimates. */
export const COMPARE_FIELDS: Record<string, Provenance> = {
  jobs: 'measured',
  queueP50s: 'measured',
  queueP95s: 'measured',
  runP50s: 'measured',
  runP95s: 'measured',
  prPassRate: 'measured',
  infraRate: 'measured',
  rawMinutes: 'measured',
  busyHours: 'measured',
  speedFactor: 'measured',
  billedMinutes: 'estimated',
  monthCost: 'estimated',
  monthEnergyCost: 'estimated',
  monthWearCost: 'estimated',
  monthMinutes: 'estimated',
  includedLeft: 'estimated',
  whatIf: 'estimated',
}

// ─────────────────────────────────────────────────────────────────────────────
// The aggregate (SQL function output, or its TypeScript mirror)
// ─────────────────────────────────────────────────────────────────────────────

export interface ComparisonGroup {
  project_id: string
  repo: string
  runner_class: CiRunnerKind
  os: RunnerOs
  runner_base: string | null
  labels: string[]
  jobs: number
  expired: number
  finished: number
  infra: number
  pr_counted: number
  pr_passed: number
  queue_p50: number | null
  queue_p95: number | null
  run_p50: number | null
  run_p95: number | null
  raw_seconds: number
  billed_minutes: number
  rerun_jobs: number
  rerun_billed_minutes: number
  tiny_jobs: number
  tiny_raw_seconds: number
}

export interface ComparisonPair {
  project_id: string
  repo: string
  workflow_name: string
  job_name: string
  runner_class: CiRunnerKind
  passed: number
  run_p50: number | null
}

export interface ComparisonWorkflow {
  project_id: string
  repo: string
  workflow_name: string
  job_name: string
  runner_class: CiRunnerKind
  os: RunnerOs
  runner_base: string | null
  labels: string[]
  jobs: number
  billed_minutes: number
  raw_seconds: number
  main_billed_minutes: number
  dependabot_billed_minutes: number
}

export interface ComparisonData {
  groups: ComparisonGroup[]
  pairs: ComparisonPair[]
  workflows: ComparisonWorkflow[]
  /** Self-hosted job intervals merged per runner base (ISO strings). */
  intervals: Array<{ runner_base: string; start: string; end: string }>
  oldest: string | null
  jobs: number
}

/** The ci_jobs columns the aggregate reads. */
export interface CompareJobRow {
  project_id: string
  repo: string
  workflow_name: string | null
  job_name: string
  event: string | null
  head_branch: string | null
  pr_number: number | null
  run_attempt: number | null
  status: string
  ci_kind: string
  runner_name: string | null
  runner_group_name: string | null
  runner_kind: CiRunnerKind
  runner_labels: string[] | null
  queue_seconds: number | null
  duration_seconds: number | null
  started_at: string | null
  completed_at: string | null
  gh_created_at: string
}

export const COMPARE_JOB_COLUMNS =
  'project_id, repo, workflow_name, job_name, event, head_branch, pr_number, run_attempt, status, ci_kind, runner_name, runner_group_name, runner_kind, runner_labels, queue_seconds, duration_seconds, started_at, completed_at, gh_created_at'

/** The runner class of a stored job: its stored kind, healed from the runner group when it says unknown. */
export function classOfJob(j: Pick<CompareJobRow, 'runner_kind' | 'runner_labels' | 'runner_name' | 'runner_group_name'>): CiRunnerKind {
  if (j.runner_kind === 'self_hosted' || j.runner_kind === 'github_hosted') return j.runner_kind
  return runnerKindOf({ labels: j.runner_labels ?? [], runner_name: j.runner_name, runner_group_name: j.runner_group_name })
}

function ran(j: CompareJobRow): boolean {
  return j.status === 'completed' && j.started_at != null && typeof j.duration_seconds === 'number'
}

function isMain(branch: string | null): boolean {
  return branch === 'main' || branch === 'master'
}

function isDependabot(branch: string | null): boolean {
  return (branch ?? '').startsWith('dependabot/')
}

/** The TypeScript mirror of ci_runner_comparison. Jobs before `from` or after `to` are ignored. */
export function aggregateCiJobs(rows: readonly CompareJobRow[], window?: { from: Date; to: Date }): ComparisonData {
  const groups = new Map<string, { g: ComparisonGroup; queue: number[]; run: number[]; labels: Set<string> }>()
  const pairs = new Map<string, { p: ComparisonPair; run: number[] }>()
  const workflows = new Map<string, { w: ComparisonWorkflow; labels: Set<string> }>()
  const intervals = new Map<string, Array<[number, number]>>()
  let oldest: string | null = null
  let count = 0

  for (const j of rows) {
    const created = Date.parse(j.gh_created_at)
    if (window && (!(created >= window.from.getTime()) || created > window.to.getTime())) continue
    count++
    if (!oldest || j.gh_created_at < oldest) oldest = j.gh_created_at
    const cls = classOfJob(j)
    const os = runnerOsOf({ labels: j.runner_labels ?? [], runner_name: j.runner_name })
    const base = cls === 'self_hosted' && j.runner_name ? runnerBaseName(j.runner_name) : null
    const labels = (j.runner_labels ?? []).slice(0, 10)
    const did = ran(j)
    const billed = did ? billedMinutesOf(j.duration_seconds) : 0
    const dur = did ? (j.duration_seconds as number) : 0

    const gk = `${j.project_id}|${j.repo}|${cls}|${os}|${base ?? ''}`
    let ge = groups.get(gk)
    if (!ge) {
      ge = {
        g: { project_id: j.project_id, repo: j.repo, runner_class: cls, os, runner_base: base, labels: [], jobs: 0, expired: 0, finished: 0, infra: 0, pr_counted: 0, pr_passed: 0, queue_p50: null, queue_p95: null, run_p50: null, run_p95: null, raw_seconds: 0, billed_minutes: 0, rerun_jobs: 0, rerun_billed_minutes: 0, tiny_jobs: 0, tiny_raw_seconds: 0 },
        queue: [],
        run: [],
        labels: new Set(),
      }
      groups.set(gk, ge)
    }
    const g = ge.g
    labels.forEach((l) => ge!.labels.add(l))
    g.jobs++
    if (j.ci_kind === 'queue_expired') g.expired++
    if (j.status === 'completed' && j.ci_kind !== 'skipped') {
      g.finished++
      if (INFRA.has(j.ci_kind)) g.infra++
    }
    const pr = PR_EVENTS.has(j.event ?? '') || j.pr_number != null
    if (pr && COUNTED.has(j.ci_kind)) {
      g.pr_counted++
      if (j.ci_kind === 'passed') g.pr_passed++
    }
    if (j.started_at != null && typeof j.queue_seconds === 'number') ge.queue.push(j.queue_seconds)
    if (did) {
      ge.run.push(dur)
      g.raw_seconds += dur
      g.billed_minutes += billed
      if ((j.run_attempt ?? 1) > 1) {
        g.rerun_jobs++
        g.rerun_billed_minutes += billed
      }
      if (dur < TINY_JOB_S) {
        g.tiny_jobs++
        g.tiny_raw_seconds += dur
      }
    }

    const wfName = j.workflow_name ?? '(unnamed workflow)'
    if (did) {
      const wk = `${j.project_id}|${j.repo}|${wfName}|${j.job_name}|${cls}|${os}|${base ?? ''}`
      let we = workflows.get(wk)
      if (!we) {
        we = { w: { project_id: j.project_id, repo: j.repo, workflow_name: wfName, job_name: j.job_name, runner_class: cls, os, runner_base: base, labels: [], jobs: 0, billed_minutes: 0, raw_seconds: 0, main_billed_minutes: 0, dependabot_billed_minutes: 0 }, labels: new Set() }
        workflows.set(wk, we)
      }
      labels.forEach((l) => we!.labels.add(l))
      we.w.jobs++
      we.w.billed_minutes += billed
      we.w.raw_seconds += dur
      if (isMain(j.head_branch)) we.w.main_billed_minutes += billed
      if (isDependabot(j.head_branch)) we.w.dependabot_billed_minutes += billed
    }

    if (did && j.ci_kind === 'passed') {
      const pk = `${j.project_id}|${j.repo}|${wfName}|${j.job_name}|${cls}`
      let pe = pairs.get(pk)
      if (!pe) {
        pe = { p: { project_id: j.project_id, repo: j.repo, workflow_name: wfName, job_name: j.job_name, runner_class: cls, passed: 0, run_p50: null }, run: [] }
        pairs.set(pk, pe)
      }
      pe.p.passed++
      pe.run.push(dur)
    }

    if (did && base && j.started_at && j.completed_at) {
      const a = Date.parse(j.started_at)
      const b = Date.parse(j.completed_at)
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) intervals.set(base, [...(intervals.get(base) ?? []), [a, b]])
    }
  }

  for (const e of groups.values()) {
    e.g.labels = [...e.labels].sort()
    e.g.queue_p50 = percentile(e.queue, 50)
    e.g.queue_p95 = percentile(e.queue, 95)
    e.g.run_p50 = percentile(e.run, 50)
    e.g.run_p95 = percentile(e.run, 95)
  }
  for (const e of pairs.values()) e.p.run_p50 = percentile(e.run, 50)
  for (const e of workflows.values()) e.w.labels = [...e.labels].sort()

  return {
    groups: [...groups.values()].map((e) => e.g),
    pairs: [...pairs.values()].map((e) => e.p),
    workflows: [...workflows.values()].map((e) => e.w),
    intervals: [...intervals.entries()].flatMap(([base, list]) =>
      mergeIntervals(list).map(([a, b]) => ({ runner_base: base, start: new Date(a).toISOString(), end: new Date(b).toISOString() })),
    ),
    oldest,
    jobs: count,
  }
}

const nnum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const num0 = (v: unknown): number => nnum(v) ?? 0
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const cls = (v: unknown): CiRunnerKind => (v === 'self_hosted' || v === 'github_hosted' ? v : 'unknown')
const osOf = (v: unknown): RunnerOs => (v === 'windows' || v === 'macos' ? v : 'linux')
const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [])

/** The SQL function's jsonb (numbers may arrive as strings), read defensively. Null when it is not that shape. */
export function readComparisonData(value: unknown): ComparisonData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.groups)) return null
  return {
    groups: arr(v.groups).map((g) => ({
      project_id: String(g.project_id ?? ''),
      repo: String(g.repo ?? ''),
      runner_class: cls(g.runner_class),
      os: osOf(g.os),
      runner_base: str(g.runner_base),
      labels: strs(g.labels),
      jobs: num0(g.jobs),
      expired: num0(g.expired),
      finished: num0(g.finished),
      infra: num0(g.infra),
      pr_counted: num0(g.pr_counted),
      pr_passed: num0(g.pr_passed),
      queue_p50: nnum(g.queue_p50),
      queue_p95: nnum(g.queue_p95),
      run_p50: nnum(g.run_p50),
      run_p95: nnum(g.run_p95),
      raw_seconds: num0(g.raw_seconds),
      billed_minutes: num0(g.billed_minutes),
      rerun_jobs: num0(g.rerun_jobs),
      rerun_billed_minutes: num0(g.rerun_billed_minutes),
      tiny_jobs: num0(g.tiny_jobs),
      tiny_raw_seconds: num0(g.tiny_raw_seconds),
    })),
    pairs: arr(v.pairs).map((p) => ({
      project_id: String(p.project_id ?? ''),
      repo: String(p.repo ?? ''),
      workflow_name: String(p.workflow_name ?? ''),
      job_name: String(p.job_name ?? ''),
      runner_class: cls(p.runner_class),
      passed: num0(p.passed),
      run_p50: nnum(p.run_p50),
    })),
    workflows: arr(v.workflows).map((w) => ({
      project_id: String(w.project_id ?? ''),
      repo: String(w.repo ?? ''),
      workflow_name: String(w.workflow_name ?? ''),
      job_name: String(w.job_name ?? ''),
      runner_class: cls(w.runner_class),
      os: osOf(w.os),
      runner_base: str(w.runner_base),
      labels: strs(w.labels),
      jobs: num0(w.jobs),
      billed_minutes: num0(w.billed_minutes),
      raw_seconds: num0(w.raw_seconds),
      main_billed_minutes: num0(w.main_billed_minutes),
      dependabot_billed_minutes: num0(w.dependabot_billed_minutes),
    })),
    intervals: arr(v.intervals)
      .map((i) => ({ runner_base: String(i.runner_base ?? ''), start: String(i.start ?? ''), end: String(i.end ?? '') }))
      .filter((i) => i.runner_base && i.start && i.end),
    oldest: str(v.oldest),
    jobs: num0(v.jobs),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Speed
// ─────────────────────────────────────────────────────────────────────────────

/** Per job that passed on both classes: medians, sample sizes, and the factor when both sides have ≥ 5. */
export function speedFactors(pairs: readonly ComparisonPair[]): CiCompareSpeed[] {
  const byJob = new Map<string, { repo: string; workflow: string; job: string; hosted: ComparisonPair[]; self: ComparisonPair[] }>()
  for (const p of pairs) {
    if (p.runner_class === 'unknown') continue
    const k = `${p.repo}|${p.workflow_name}|${p.job_name}`
    const e = byJob.get(k) ?? { repo: p.repo, workflow: p.workflow_name, job: p.job_name, hosted: [], self: [] }
    ;(p.runner_class === 'github_hosted' ? e.hosted : e.self).push(p)
    byJob.set(k, e)
  }
  const out: CiCompareSpeed[] = []
  for (const e of byJob.values()) {
    if (e.hosted.length === 0 || e.self.length === 0) continue
    // Two projects bound to one repo store the same job twice: take the larger sample.
    const h = e.hosted.sort((a, b) => b.passed - a.passed)[0]
    const s = e.self.sort((a, b) => b.passed - a.passed)[0]
    const enough = h.passed >= MIN_SPEED_SAMPLES && s.passed >= MIN_SPEED_SAMPLES && (h.run_p50 ?? 0) > 0 && s.run_p50 != null
    out.push({
      repo: e.repo,
      workflow: e.workflow,
      job: e.job,
      hostedP50s: h.run_p50,
      selfHostedP50s: s.run_p50,
      hostedSamples: h.passed,
      selfHostedSamples: s.passed,
      factor: enough ? Math.round(((s.run_p50 as number) / (h.run_p50 as number)) * 100) / 100 : null,
    })
  }
  return out.sort((a, b) => a.repo.localeCompare(b.repo) || a.workflow.localeCompare(b.workflow) || a.job.localeCompare(b.job))
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * self-hosted ÷ GitHub-hosted for a set of jobs: the median of the measured
 * per-job factors. Not measured → 1.0, with `measured: false`.
 */
export function combinedSpeedFactor(speed: readonly CiCompareSpeed[]): { factor: number; measured: boolean; samplesHosted: number; samplesSelf: number } {
  const measured = speed.filter((s) => s.factor != null)
  if (measured.length === 0) return { factor: 1, measured: false, samplesHosted: speed.reduce((n, s) => n + s.hostedSamples, 0), samplesSelf: speed.reduce((n, s) => n + s.selfHostedSamples, 0) }
  return {
    factor: Math.round(medianOf(measured.map((s) => s.factor as number)) * 100) / 100,
    measured: true,
    samplesHosted: measured.reduce((n, s) => n + s.hostedSamples, 0),
    samplesSelf: measured.reduce((n, s) => n + s.selfHostedSamples, 0),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Building the response
// ─────────────────────────────────────────────────────────────────────────────

export interface CompareHost {
  host_id: string
  hostname: string
  /** metrics.machine_id: hosts (e.g. WSL distros) on one physical machine report the same id. */
  metrics: Record<string, unknown> | null
  runners: Array<Record<string, unknown>> | null
}

export interface CompareInput {
  now: Date
  days: number
  from: Date
  to: Date
  data: ComparisonData
  source: 'sql' | 'rows'
  sourceNote: string | null
  projects: Array<{ id: string; name: string | null; organization_id: string | null }>
  repoBindings: Array<{ project_id: string; repo: string }>
  /** Per repo full name, from ci_collector_state.permissions. */
  repoMeta: Record<string, { visibility?: RepoVisibility; owner?: string }>
  settingsByOrg: Map<string, CiCompareSettings>
  defaultSettings: CiCompareSettings
  settingsWritable: boolean
  hosts: CompareHost[]
  /** ci_runners rows: online state per runner. */
  runners: Array<{ repo: string; runner_name: string; status: string; labels: string[] | null }>
  workflows: Array<{ projectId: string; repo: string; path: string; text: string }>
  /** Repo variable names from the GitHub snapshot; null = not readable. */
  variableNames: Record<string, string[] | null>
  /** How many what-ifs to return (default MAX_WHAT_IFS); the placement preview asks for all. */
  whatIfLimit?: number
}

interface MachineInfo {
  name: string
  source: CiCompareMachine['source']
  wattsIdle: number | null
  wattsLoad: number | null
}

/** Which physical machine a self-hosted runner base runs on: your settings, then heartbeats (same machine id), then the runner itself. */
export function resolveMachine(runner: string, settings: CiCompareSettings, hosts: readonly CompareHost[]): MachineInfo {
  const fromSettings = machineFromSettings(runner, settings.machines)
  if (fromSettings) return { name: fromSettings.name, source: 'settings', wattsIdle: fromSettings.wattsIdle ?? null, wattsLoad: fromSettings.wattsLoad ?? null }
  const host = hosts.find((h) => (h.runners ?? []).some((r) => typeof r.name === 'string' && runnerNameMatches(r.name, runner)))
  if (host) {
    const mid = typeof host.metrics?.machine_id === 'string' ? host.metrics.machine_id : null
    const same = mid ? hosts.filter((h) => h.metrics?.machine_id === mid) : [host]
    return { name: [...new Set(same.map((h) => h.hostname))].sort().join(' + '), source: 'heartbeat', wattsIdle: null, wattsLoad: null }
  }
  return { name: runner, source: 'runner', wattsIdle: null, wattsLoad: null }
}

function repoVisibility(meta: CompareInput['repoMeta'], repo: string): RepoVisibility {
  const m = meta[repo] ?? meta[Object.keys(meta).find((k) => k.toLowerCase() === repo.toLowerCase()) ?? '']
  return m?.visibility ?? 'unknown'
}

function repoOwner(meta: CompareInput['repoMeta'], repo: string): string {
  return meta[repo]?.owner ?? repo.split('/')[0]
}

/** A GitHub-hosted group on a standard runner (Linux, Windows, macOS image labels), not a larger runner. */
function standardHosted(labels: readonly string[]): boolean {
  return labels.length === 0 || labels.every(isHostedLabel)
}

function labelOf(labels: readonly string[], fallback: string): string {
  return labels.filter((l) => l.toLowerCase() !== 'self-hosted').join(', ') || fallback
}

export function buildCiCompare(input: CompareInput): CiCompare {
  const { data, now } = input
  const projectById = new Map(input.projects.map((p) => [p.id, p]))
  const settingsFor = (projectId: string): CiCompareSettings => {
    const org = projectById.get(projectId)?.organization_id
    return (org && input.settingsByOrg.get(org)) || input.defaultSettings
  }
  const oldestMs = data.oldest ? Date.parse(data.oldest) : NaN
  const spanMs = Number.isFinite(oldestMs) ? Math.min(input.to.getTime() - input.from.getTime(), input.to.getTime() - oldestMs) : 0
  const dataDays = Math.max(0, Math.round((spanMs / DAY_MS) * 10) / 10)
  const spanDays = Math.max(1, dataDays)
  const spanHours = Math.max(1, spanMs / 3_600_000)

  // ── Repos ────────────────────────────────────────────────────────────────
  const repoKeys = new Map<string, { projectId: string; repo: string }>()
  for (const b of input.repoBindings) repoKeys.set(`${b.project_id}|${b.repo}`, { projectId: b.project_id, repo: b.repo })
  for (const g of data.groups) if (!repoKeys.has(`${g.project_id}|${g.repo}`)) repoKeys.set(`${g.project_id}|${g.repo}`, { projectId: g.project_id, repo: g.repo })
  const repos = [...repoKeys.values()].map((r) => ({
    projectId: r.projectId,
    projectName: projectById.get(r.projectId)?.name ?? 'Project',
    repo: r.repo,
    visibility: repoVisibility(input.repoMeta, r.repo),
    owner: input.repoMeta[r.repo]?.owner ?? r.repo.split('/')[0] ?? null,
  }))

  // ── Machines (self-hosted) ───────────────────────────────────────────────
  const machineOfBase = new Map<string, MachineInfo & { settings: CiCompareSettings }>()
  for (const g of data.groups) {
    if (g.runner_class !== 'self_hosted' || !g.runner_base || machineOfBase.has(g.runner_base)) continue
    const s = settingsFor(g.project_id)
    machineOfBase.set(g.runner_base, { ...resolveMachine(g.runner_base, s, input.hosts), settings: s })
  }
  const intervalsByBase = new Map<string, Array<[number, number]>>()
  for (const i of data.intervals) {
    const a = Date.parse(i.start)
    const b = Date.parse(i.end)
    if (Number.isFinite(a) && Number.isFinite(b)) intervalsByBase.set(i.runner_base, [...(intervalsByBase.get(i.runner_base) ?? []), [a, b]])
  }
  const online = new Map<string, boolean>()
  for (const r of input.runners) {
    const base = runnerBaseName(r.runner_name)
    online.set(base, (online.get(base) ?? false) || r.status === 'online')
  }

  interface MachineAcc {
    name: string
    source: CiCompareMachine['source']
    settings: CiCompareSettings
    wattsIdle: number
    wattsLoad: number
    runners: Set<string>
    repos: Set<string>
    intervals: Array<[number, number]>
    rawSeconds: number
    billedMinutes: number
    queueP95: number | null
    online: boolean | null
  }
  const machines = new Map<string, MachineAcc>()
  for (const g of data.groups) {
    if (g.runner_class !== 'self_hosted' || !g.runner_base) continue
    const info = machineOfBase.get(g.runner_base)!
    let m = machines.get(info.name)
    if (!m) {
      m = {
        name: info.name,
        source: info.source,
        settings: info.settings,
        wattsIdle: info.wattsIdle ?? info.settings.wattsIdle,
        wattsLoad: Math.max(info.wattsIdle ?? info.settings.wattsIdle, info.wattsLoad ?? info.settings.wattsLoad),
        runners: new Set(),
        repos: new Set(),
        intervals: [],
        rawSeconds: 0,
        billedMinutes: 0,
        queueP95: null,
        online: null,
      }
      machines.set(info.name, m)
    }
    if (!m.runners.has(g.runner_base)) {
      m.runners.add(g.runner_base)
      m.intervals.push(...(intervalsByBase.get(g.runner_base) ?? []))
    }
    m.repos.add(g.repo)
    m.rawSeconds += g.raw_seconds
    m.billedMinutes += g.billed_minutes
    if (g.queue_p95 != null) m.queueP95 = Math.max(m.queueP95 ?? 0, g.queue_p95)
    if (online.has(g.runner_base)) m.online = (m.online ?? false) || (online.get(g.runner_base) as boolean)
  }
  const machineOut: CiCompareMachine[] = []
  const machineMonth = new Map<string, { total: number; energy: number; wear: number; fee: number; busyHours: number; acc: MachineAcc }>()
  for (const m of machines.values()) {
    const busyHours = unionSeconds(m.intervals) / 3600
    const s = m.settings
    const cost = machineCost({
      busyHours: toMonth(busyHours, spanDays),
      billedMinutes: toMonth(m.billedMinutes, spanDays),
      wattsIdle: m.wattsIdle,
      wattsLoad: m.wattsLoad,
      pricePerKwh: s.pricePerKwh,
      wearPerHour: s.wearPerHour,
      feePerMinuteUsd: s.selfHostedFeePerMinuteUsd,
      fxPerUsd: s.fxPerUsd,
    })
    machineMonth.set(m.name, { total: cost.energy + cost.wear + cost.platformFee, energy: cost.energy, wear: cost.wear, fee: cost.platformFee, busyHours, acc: m })
    machineOut.push({
      name: m.name,
      source: m.source,
      runners: [...m.runners].sort(),
      repos: [...m.repos].sort(),
      busyHours: Math.round(busyHours * 100) / 100,
      busyShare: Math.round(Math.min(1, busyHours / spanHours) * 1000) / 1000,
      wattsIdle: m.wattsIdle,
      wattsLoad: m.wattsLoad,
      monthEnergyCost: money(cost.energy),
      monthWearCost: money(cost.wear),
      monthPlatformFee: money(cost.platformFee),
      queueP95s: m.queueP95,
      online: m.online,
      currency: s.currency,
    })
  }

  // ── GitHub accounts: included minutes per owner ─────────────────────────
  interface AccountAcc { owner: string; settings: CiCompareSettings; listMonthUsd: number; privateRepos: Set<string>; publicRepos: Set<string> }
  const accounts = new Map<string, AccountAcc>()
  const accountOf = (repo: string, projectId: string): AccountAcc => {
    const owner = repoOwner(input.repoMeta, repo)
    let a = accounts.get(owner.toLowerCase())
    if (!a) {
      a = { owner, settings: settingsFor(projectId), listMonthUsd: 0, privateRepos: new Set(), publicRepos: new Set() }
      accounts.set(owner.toLowerCase(), a)
    }
    return a
  }
  for (const r of repos) {
    const a = accountOf(r.repo, r.projectId)
    if (r.visibility === 'public') a.publicRepos.add(r.repo)
    else a.privateRepos.add(r.repo)
  }

  // Rows first with list prices, then the account's included minutes are spread over them.
  const rowList: Array<{ row: CiCompareRow; listMonthUsd: number; account: AccountAcc | null }> = []
  for (const g of data.groups) {
    const s = settingsFor(g.project_id)
    const visibility = repoVisibility(input.repoMeta, g.repo)
    const machine = g.runner_class === 'self_hosted' && g.runner_base ? machineOfBase.get(g.runner_base)?.name ?? g.runner_base : null
    let basis: CiCompareRow['costBasis'] = 'unknown'
    let listMonthUsd = 0
    let monthCost = 0
    let account: AccountAcc | null = null
    if (g.runner_class === 'github_hosted') {
      if (!standardHosted(g.labels)) basis = 'github_larger_unpriced'
      else if (visibility === 'public') basis = 'github_public_free'
      else {
        basis = 'github_list'
        listMonthUsd = toMonth(g.billed_minutes, spanDays) * usdPerMinuteFor({ labels: g.labels.length ? g.labels : [g.os === 'linux' ? 'ubuntu-latest' : `${g.os}-latest`] })
        account = accountOf(g.repo, g.project_id)
        account.listMonthUsd += listMonthUsd
      }
    } else if (g.runner_class === 'self_hosted' && machine) {
      basis = 'self_hosted'
      const mm = machineMonth.get(machine)
      if (mm && mm.acc.rawSeconds > 0) monthCost = (mm.total * g.raw_seconds) / mm.acc.rawSeconds
    }
    rowList.push({
      listMonthUsd,
      account,
      row: {
        key: `${g.project_id}|${g.repo}|${g.runner_class}|${g.os}|${g.runner_base ?? ''}`,
        projectId: g.project_id,
        repo: g.repo,
        runnerClass: g.runner_class,
        os: g.os,
        labels: g.labels,
        runner: g.runner_base,
        machine,
        jobs: g.jobs,
        expired: g.expired,
        queueP50s: g.queue_p50,
        queueP95s: g.queue_p95,
        runP50s: g.run_p50,
        runP95s: g.run_p95,
        prPassRate: g.pr_counted > 0 ? Math.round((g.pr_passed / g.pr_counted) * 1000) / 1000 : null,
        prJobs: g.pr_counted,
        infraRate: g.finished > 0 ? Math.round((g.infra / g.finished) * 1000) / 1000 : null,
        rawMinutes: Math.round((g.raw_seconds / 60) * 10) / 10,
        billedMinutes: g.billed_minutes,
        rerunJobs: g.rerun_jobs,
        tinyJobs: g.tiny_jobs,
        monthCost,
        costBasis: basis,
        currency: s.currency,
      },
    })
  }
  const accountOut: CiCompareAccount[] = []
  for (const a of accounts.values()) {
    const fx = a.settings.fxPerUsd
    const month = accountMonthCost(a.listMonthUsd, a.settings.includedMinutes)
    const mine = rowList.filter((r) => r.account === a)
    const shares = allocate(month.costUsd, mine.map((r) => r.listMonthUsd))
    mine.forEach((r, i) => (r.row.monthCost = shares[i] * fx))
    accountOut.push({
      owner: a.owner,
      plan: a.settings.plan,
      includedMinutes: a.settings.includedMinutes,
      monthMinutes: Math.round(a.listMonthUsd / GITHUB_RUNNER_RATES.usdPerMinute.linux),
      monthListCost: money(a.listMonthUsd * fx),
      monthCost: money(month.costUsd * fx),
      includedLeft: month.includedLeftMinutes,
      privateRepos: a.privateRepos.size,
      publicRepos: a.publicRepos.size,
      currency: a.settings.currency,
    })
  }
  for (const r of rowList) r.row.monthCost = money(r.row.monthCost)
  const rows = rowList.map((r) => r.row).sort((a, b) => a.repo.localeCompare(b.repo) || a.runnerClass.localeCompare(b.runnerClass) || b.jobs - a.jobs)

  // ── Speed, workflows, what-ifs ───────────────────────────────────────────
  const speed = speedFactors(data.pairs)
  const parsedByRepo = new Map<string, ParsedWorkflow[]>()
  for (const w of input.workflows) {
    const list = parsedByRepo.get(w.repo) ?? []
    list.push(...parseRepoWorkflows([{ path: w.path, text: w.text }]))
    parsedByRepo.set(w.repo, list)
  }
  const yamlJobFor = (repo: string, workflow: string, job: string): RunsOnJob | null | undefined => {
    const parsed = parsedByRepo.get(repo)
    if (!parsed) return undefined // no YAML read for this repo
    for (const p of parsed) for (const j of p.jobs) if (runsOnJobMatches(j, workflow, job)) return j
    return null
  }

  const marginalHostedSaving = (account: AccountAcc, movedListUsd: number): number => {
    const before = accountMonthCost(account.listMonthUsd, account.settings.includedMinutes).costUsd
    const after = accountMonthCost(Math.max(0, account.listMonthUsd - movedListUsd), account.settings.includedMinutes).costUsd
    return before - after
  }
  const marginalHostedAdd = (account: AccountAcc, addedListUsd: number): number => {
    const before = accountMonthCost(account.listMonthUsd, account.settings.includedMinutes).costUsd
    const after = accountMonthCost(account.listMonthUsd + addedListUsd, account.settings.includedMinutes).costUsd
    return after - before
  }

  const whatIfs: CiCompareWhatIf[] = []
  const wfByRepoWorkflow = new Map<string, ComparisonWorkflow[]>()
  for (const w of data.workflows) {
    const k = `${w.project_id}|${w.repo}|${w.workflow_name}`
    wfByRepoWorkflow.set(k, [...(wfByRepoWorkflow.get(k) ?? []), w])
  }
  for (const r of repos) {
    const settings = settingsFor(r.projectId)
    const fx = settings.fxPerUsd
    // The repo's main self-hosted machine: most job time in the window.
    const selfRows = rows.filter((x) => x.projectId === r.projectId && x.repo === r.repo && x.runnerClass === 'self_hosted' && x.machine)
    const homeRow = selfRows.sort((a, b) => b.rawMinutes - a.rawMinutes)[0] ?? null
    const home = homeRow ? machineMonth.get(homeRow.machine as string) ?? null : null
    for (const [k, list] of wfByRepoWorkflow) {
      if (!k.startsWith(`${r.projectId}|${r.repo}|`)) continue
      const workflow = list[0].workflow_name
      const hosted = list.filter((w) => w.runner_class === 'github_hosted' && standardHosted(w.labels))
      const self = list.filter((w) => w.runner_class === 'self_hosted')
      const wfSpeed = combinedSpeedFactor(speed.filter((s) => s.repo === r.repo && s.workflow === workflow))

      // GitHub-hosted → your machine (private repos: that is where the money is).
      if (hosted.length > 0 && r.visibility !== 'public' && home && homeRow) {
        let movedBilled = 0
        let movedRaw = 0
        let movedList = 0
        const stays: CiCompareWhatIf['stays'] = []
        const noYaml = !parsedByRepo.has(r.repo)
        for (const w of hosted) {
          const y = yamlJobFor(r.repo, workflow, w.job_name)
          let billed = w.billed_minutes
          if (y && y.kind === 'pinned_hosted') {
            stays.push({ job: w.job_name, reason: y.pinnedReason ? `Pinned to GitHub: ${y.pinnedReason}` : 'Pinned to GitHub in the workflow (no reason given).' })
            continue
          }
          if (y === null || (y && y.kind !== 'follows_variable')) {
            stays.push({ job: w.job_name, reason: 'Its runs-on does not read a repo variable; only a workflow change moves it.' })
            continue
          }
          if (y?.hostedOnMain && w.main_billed_minutes > 0) {
            billed -= w.main_billed_minutes
            stays.push({ job: `${w.job_name} (main)`, reason: 'Runs on main always use GitHub (the workflow checks github.ref).' })
          }
          if (y?.hostedForDependabot && w.dependabot_billed_minutes > 0) {
            billed -= w.dependabot_billed_minutes
            stays.push({ job: `${w.job_name} (Dependabot)`, reason: 'Dependabot runs always use GitHub (the workflow checks github.actor).' })
          }
          if (billed <= 0) continue
          const share = w.billed_minutes > 0 ? billed / w.billed_minutes : 0
          movedBilled += billed
          movedRaw += w.raw_seconds * share
          movedList += billed * usdPerMinuteFor({ labels: w.labels })
        }
        if (movedBilled > 0) {
          const account = accountOf(r.repo, r.projectId)
          const now$ = marginalHostedSaving(account, toMonth(movedList, spanDays)) * fx
          const addHours = toMonth((movedRaw * wfSpeed.factor) / 3600, spanDays)
          const m = home.acc
          const after = machineCost({ busyHours: addHours, billedMinutes: toMonth(movedBilled, spanDays), wattsIdle: m.wattsIdle, wattsLoad: m.wattsLoad, pricePerKwh: m.settings.pricePerKwh, wearPerHour: m.settings.wearPerHour, feePerMinuteUsd: m.settings.selfHostedFeePerMinuteUsd, fxPerUsd: m.settings.fxPerUsd })
          const after$ = after.energy + after.wear + after.platformFee
          const busyNow = Math.min(1, home.busyHours / spanHours)
          const busyAfter = Math.min(1, (home.busyHours + (movedRaw * wfSpeed.factor) / 3600) / spanHours)
          const warnings: string[] = []
          if (noYaml) warnings.push('Mushi has not read this repo\'s workflow files, so jobs pinned to GitHub may be counted as moving.')
          if (m.online === false) warnings.push(`No runner on ${m.name} is online: moved jobs would wait, then expire after 24 h.`)
          if (busyAfter > BUSY_WARN_SHARE) warnings.push(`${m.name} would be busy ${Math.round(busyAfter * 100)}% of the time: jobs will queue.`)
          if (!wfSpeed.measured) warnings.push('Speed not measured (fewer than 5 passed runs on each side): assuming the same run time.')
          whatIfs.push({
            id: `to_self:${r.projectId}:${r.repo}:${workflow}`,
            projectId: r.projectId,
            repo: r.repo,
            workflow,
            from: { runnerClass: 'github_hosted', label: labelOf(hosted[0].labels, 'GitHub-hosted'), machine: null },
            to: { runnerClass: 'self_hosted', label: labelOf(homeRow.labels, homeRow.runner ?? 'self-hosted'), machine: m.name },
            monthMinutesMoved: Math.round(toMonth(movedBilled, spanDays)),
            stays,
            speed: { factor: wfSpeed.factor, measured: wfSpeed.measured, samplesFrom: wfSpeed.samplesHosted, samplesTo: wfSpeed.samplesSelf },
            monthCostNow: money(now$),
            monthCostAfter: money(after$),
            monthCostDelta: money(after$ - now$),
            targetQueueP95s: m.queueP95,
            targetBusyShare: Math.round(busyNow * 1000) / 1000,
            targetBusyShareAfter: Math.round(busyAfter * 1000) / 1000,
            warnings,
            currency: settings.currency,
          })
        }
      }

      // Your machine → GitHub-hosted: free on a public repo; on a private one only worth it for speed.
      const selfMinutes = self.reduce((n, w) => n + w.billed_minutes, 0)
      if (self.length > 0 && selfMinutes > 0) {
        const machineName = self[0].runner_base ? machineOfBase.get(self[0].runner_base)?.name ?? null : null
        const mm = machineName ? machineMonth.get(machineName) : undefined
        const slow = (mm?.acc.queueP95 ?? 0) > 15 * 60
        if (r.visibility === 'public' || slow) {
          const raw = self.reduce((n, w) => n + w.raw_seconds, 0)
          const now$ = mm && mm.acc.rawSeconds > 0 ? (mm.total * raw) / mm.acc.rawSeconds : 0
          const inverse = wfSpeed.measured && wfSpeed.factor > 0 ? Math.round((1 / wfSpeed.factor) * 100) / 100 : 1
          const addList = toMonth(selfMinutes * inverse, spanDays) * GITHUB_RUNNER_RATES.usdPerMinute.linux
          const after$ = r.visibility === 'public' ? 0 : marginalHostedAdd(accountOf(r.repo, r.projectId), addList) * fx
          const warnings: string[] = []
          if (r.visibility !== 'public') warnings.push('This is a private repo: GitHub-hosted minutes are billed after the included minutes.')
          if (!wfSpeed.measured) warnings.push('Speed not measured (fewer than 5 passed runs on each side): assuming the same run time.')
          whatIfs.push({
            id: `to_hosted:${r.projectId}:${r.repo}:${workflow}`,
            projectId: r.projectId,
            repo: r.repo,
            workflow,
            from: { runnerClass: 'self_hosted', label: labelOf(self[0].labels, self[0].runner_base ?? 'self-hosted'), machine: machineName },
            to: { runnerClass: 'github_hosted', label: 'ubuntu-latest', machine: null },
            monthMinutesMoved: Math.round(toMonth(selfMinutes, spanDays)),
            stays: [],
            speed: { factor: inverse, measured: wfSpeed.measured, samplesFrom: wfSpeed.samplesSelf, samplesTo: wfSpeed.samplesHosted },
            monthCostNow: money(now$),
            monthCostAfter: money(after$),
            monthCostDelta: money(after$ - now$),
            targetQueueP95s: rows.find((x) => x.repo === r.repo && x.runnerClass === 'github_hosted')?.queueP95s ?? null,
            targetBusyShare: null,
            targetBusyShareAfter: null,
            warnings,
            currency: settings.currency,
          })
        }
      }
    }
  }
  whatIfs.sort((a, b) => Math.abs(b.monthCostDelta) - Math.abs(a.monthCostDelta) || b.monthMinutesMoved - a.monthMinutesMoved)

  // ── Why it costs what it costs ───────────────────────────────────────────
  const privateHosted = rows.filter((r) => r.runnerClass === 'github_hosted' && r.costBasis === 'github_list')
  const groupsPrivateHosted = data.groups.filter((g) => g.runner_class === 'github_hosted' && standardHosted(g.labels) && repoVisibility(input.repoMeta, g.repo) !== 'public')
  const firstSettings = input.settingsByOrg.values().next().value ?? input.defaultSettings
  const selfBilledMonth = toMonth(data.groups.filter((g) => g.runner_class === 'self_hosted').reduce((n, g) => n + g.billed_minutes, 0), spanDays)
  const pinned: CiCompareExplain['pinned'] = []
  const alwaysHosted: CiCompareExplain['alwaysHosted'] = []
  const seenAlways = new Set<string>()
  for (const w of data.workflows) {
    const vis = repoVisibility(input.repoMeta, w.repo)
    const y = yamlJobFor(w.repo, w.workflow_name, w.job_name)
    if (!y) continue
    if (w.runner_class === 'github_hosted' && y.kind === 'pinned_hosted' && vis !== 'public') {
      const s = settingsFor(w.project_id)
      pinned.push({
        repo: w.repo,
        workflow: w.workflow_name,
        job: w.job_name,
        label: y.labels.join(', '),
        reason: y.pinnedReason,
        monthCost: money(toMonth(w.billed_minutes, spanDays) * usdPerMinuteFor({ labels: y.labels }) * s.fxPerUsd),
      })
    }
    if (y.kind === 'follows_variable' && (y.hostedOnMain || y.hostedForDependabot) && vis !== 'public') {
      const key = `${w.repo}|${y.workflowPath}|${y.jobId}`
      if (seenAlways.has(key)) continue
      seenAlways.add(key)
      alwaysHosted.push({ repo: w.repo, workflow: w.workflow_name, job: w.job_name, why: y.hostedOnMain && y.hostedForDependabot ? 'main_and_dependabot' : y.hostedOnMain ? 'main' : 'dependabot' })
    }
  }
  const explain: CiCompareExplain = {
    reruns: {
      hostedJobs: privateHosted.reduce((n, r) => n + r.rerunJobs, 0),
      hostedBilledMinutes: groupsPrivateHosted.reduce((n, g) => n + g.rerun_billed_minutes, 0),
      selfHostedJobs: rows.filter((r) => r.runnerClass === 'self_hosted').reduce((n, r) => n + r.rerunJobs, 0),
    },
    tinyJobs: {
      jobs: groupsPrivateHosted.reduce((n, g) => n + g.tiny_jobs, 0),
      billedMinutes: groupsPrivateHosted.reduce((n, g) => n + g.tiny_jobs, 0),
      rawMinutes: Math.round((groupsPrivateHosted.reduce((n, g) => n + g.tiny_raw_seconds, 0) / 60) * 10) / 10,
    },
    queueExpired: { jobs: rows.reduce((n, r) => n + r.expired, 0) },
    macosToLinux: Math.round(RUNNER_PRICE_RATIO.macos * 10) / 10,
    platformFeeWhatIf: { perMinuteUsd: ANNOUNCED_SELF_HOSTED_FEE_USD, monthCost: money(selfBilledMonth * ANNOUNCED_SELF_HOSTED_FEE_USD * firstSettings.fxPerUsd) },
    pinned: pinned.sort((a, b) => b.monthCost - a.monthCost).slice(0, 15),
    alwaysHosted: alwaysHosted.slice(0, 20),
    hostedSpecs: { privateVcpu: 2, privateRamGb: 8, publicVcpu: 4, publicRamGb: 16 },
  }

  const advice = adviseCiCost({
    now,
    spanDays,
    repos,
    rows,
    machines: machineOut,
    workflows: input.workflows,
    variableNames: input.variableNames,
    parsed: parsedByRepo,
    pinned: explain.pinned,
    tinyJobs: groupsPrivateHosted.map((g) => ({ repo: g.repo, jobs: g.tiny_jobs, rawSeconds: g.tiny_raw_seconds, billedMinutes: g.billed_minutes, allJobs: g.jobs })),
  })

  const settingsList = [...input.settingsByOrg.values()]
  return {
    generatedAt: now.toISOString(),
    window: { days: input.days, from: input.from.toISOString(), to: input.to.toISOString() },
    dataDays,
    lowConfidence: dataDays < LOW_CONFIDENCE_DAYS,
    source: input.source,
    sourceNote: input.sourceNote,
    rates: { source: GITHUB_RUNNER_RATES.source, fetchedAt: GITHUB_RUNNER_RATES.fetchedAt, usdPerMinute: { ...GITHUB_RUNNER_RATES.usdPerMinute } },
    fields: COMPARE_FIELDS,
    settings: settingsList.length > 0 ? settingsList : [input.defaultSettings],
    settingsWritable: input.settingsWritable,
    repos: repos.sort((a, b) => a.repo.localeCompare(b.repo)),
    rows,
    accounts: accountOut.sort((a, b) => b.monthCost - a.monthCost),
    machines: machineOut.sort((a, b) => b.busyHours - a.busyHours),
    speed,
    whatIfs: whatIfs.slice(0, input.whatIfLimit ?? MAX_WHAT_IFS),
    explain,
    advice,
  }
}
