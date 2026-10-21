/**
 * FILE: apps/admin/src/lib/ciView.ts
 * PURPOSE: Pure reads of the CI overview for /ci, the Portfolio card and the
 *          fix loop (Plan 022, ADR 0033): job outcome, the Waiting → Running →
 *          Finished queue, the per-runner timeline, queue position for a PR,
 *          and plain-words durations. No React, so every rule is unit-tested.
 */

import type { CiJob, CiOverview } from './ciTypes'

// ── Durations ───────────────────────────────────────────────────────────────

/** "45 s", "12 min", "1 h 5 min"; null → "—". */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}

/** 0.873 → "87%"; null → "—". */
export function formatPercent(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${Math.round(rate * 100)}%`
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

// ── Job outcome ─────────────────────────────────────────────────────────────

export type CiJobOutcome = 'waiting' | 'running' | 'passed' | 'code_failure' | 'infra' | 'cancelled' | 'skipped'

const WAITING_STATUSES = new Set(['queued', 'waiting', 'pending', 'requested'])

/** Where a job stands, from its GitHub status first and Mushi's verdict second. */
export function jobOutcome(job: Pick<CiJob, 'status' | 'ciKind'>): CiJobOutcome {
  const status = job.status?.toLowerCase()
  if (WAITING_STATUSES.has(status)) return 'waiting'
  if (status === 'in_progress') return 'running'
  switch (job.ciKind) {
    case 'queued':
    case 'waiting_for_runner':
      return 'waiting'
    case 'running':
      return 'running'
    case 'passed':
      return 'passed'
    case 'skipped':
      return 'skipped'
    case 'code_failure':
      return 'code_failure'
    case 'runner_lost':
    case 'queue_expired':
      return 'infra'
    case 'cancelled':
      return 'cancelled'
  }
  return 'cancelled'
}

/**
 * Label + a glyph per outcome, so an outcome never reads by colour alone.
 * `tone` picks the token family; components map it to classes.
 */
export const CI_OUTCOME_META: Record<CiJobOutcome, { label: string; glyph: string; tone: 'ok' | 'danger' | 'warn' | 'neutral' | 'info' }> = {
  waiting: { label: 'Waiting', glyph: '◷', tone: 'neutral' },
  running: { label: 'Running', glyph: '▶', tone: 'info' },
  passed: { label: 'Passed', glyph: '✓', tone: 'ok' },
  code_failure: { label: 'Failed', glyph: '✕', tone: 'danger' },
  infra: { label: 'Test machine stopped', glyph: '⚠', tone: 'warn' },
  cancelled: { label: 'Cancelled', glyph: '⊘', tone: 'neutral' },
  skipped: { label: 'Skipped', glyph: '–', tone: 'neutral' },
}

/** Labels every self-hosted runner carries; they say nothing about which machine a job wants. */
const GENERIC_LABELS = new Set(['self-hosted', 'linux', 'x64'])

/**
 * The runner label that names the machine a job is waiting for, if it asked for one.
 * @internal Exported for tests only.
 */
export function machineLabel(job: Pick<CiJob, 'labels'>): string | null {
  for (const label of job.labels ?? []) {
    if (!GENERIC_LABELS.has(label.toLowerCase())) return label
  }
  return null
}

/** "no free test machine" / "waiting for a machine labelled nuc" hint for a waiting job, or null. */
export function waitingHint(job: Pick<CiJob, 'labels' | 'ciKind' | 'runnerName'>): string | null {
  if (job.runnerName) return null
  const label = machineLabel(job)
  if (label) return `waiting for a machine labelled ${label}`
  if (job.ciKind === 'waiting_for_runner') return 'no free test machine'
  return null
}

// ── Queue (Waiting → Running → Finished) ────────────────────────────────────

const FINISHED_WINDOW_MS = 2 * 60 * 60 * 1000

export interface CiQueue {
  waiting: CiJob[]
  running: CiJob[]
  finished: CiJob[]
}

/**
 * Waiting oldest first (longest wait leads), Running oldest start first,
 * Finished from the last `finishedWindowMs`, newest first.
 */
export function buildCiQueue(jobs: CiJob[], now: number, finishedWindowMs = FINISHED_WINDOW_MS): CiQueue {
  const waiting: CiJob[] = []
  const running: CiJob[] = []
  const finished: CiJob[] = []
  for (const job of jobs) {
    const outcome = jobOutcome(job)
    if (outcome === 'waiting') waiting.push(job)
    else if (outcome === 'running') running.push(job)
    else {
      const end = ms(job.completedAt) ?? ms(job.startedAt) ?? ms(job.createdAt)
      if (end != null && now - end <= finishedWindowMs) finished.push(job)
    }
  }
  const created = (j: CiJob) => ms(j.createdAt) ?? 0
  waiting.sort((a, b) => created(a) - created(b))
  running.sort((a, b) => (ms(a.startedAt) ?? created(a)) - (ms(b.startedAt) ?? created(b)))
  finished.sort(
    (a, b) => (ms(b.completedAt) ?? created(b)) - (ms(a.completedAt) ?? created(a)),
  )
  return { waiting, running, finished }
}

/** Seconds a waiting job has waited, or a running job has run, at `now`. */
export function jobElapsedSeconds(job: CiJob, now: number): number | null {
  const outcome = jobOutcome(job)
  const from = outcome === 'running' ? ms(job.startedAt) : outcome === 'waiting' ? ms(job.createdAt) : null
  if (from == null) return null
  return Math.max(0, Math.round((now - from) / 1000))
}

// ── Queue position for one PR (fix loop) ────────────────────────────────────

export interface CiQueuePosition {
  /** 1-based position among the jobs waiting for the same machines. */
  position: number
  total: number
  /** The label that names those machines, or null when the job did not ask for one. */
  label: string | null
  waitedSeconds: number
  jobId: string
}

/**
 * Where a PR's oldest waiting job stands. Its peers are the waiting jobs that
 * want the same machine label, or, without a label, the same repo's waiting
 * jobs. Null when the PR has nothing waiting.
 */
export function queuePositionForPr(
  jobs: CiJob[],
  pr: { repo?: string | null; prNumber: number },
  now: number,
): CiQueuePosition | null {
  const waiting = buildCiQueue(jobs, now).waiting
  const mine = waiting.find(
    (j) => j.prNumber === pr.prNumber && (!pr.repo || j.repo.toLowerCase() === pr.repo.toLowerCase()),
  )
  if (!mine) return null
  const label = machineLabel(mine)
  const peers = label
    ? waiting.filter((j) => (j.labels ?? []).includes(label))
    : waiting.filter((j) => j.repo === mine.repo)
  const position = peers.findIndex((j) => j.id === mine.id) + 1
  const created = ms(mine.createdAt) ?? now
  return {
    position,
    total: peers.length,
    label,
    waitedSeconds: Math.max(0, Math.round((now - created) / 1000)),
    jobId: mine.id,
  }
}

/** "Position 2 of 5 in the queue for machines labelled nuc (waiting 12 min)." */
export function queuePositionLine(pos: CiQueuePosition, repo: string | null): string {
  const target = pos.label ? `machines labelled ${pos.label}` : repo ? `${repo}'s test machines` : 'a test machine'
  return `Position ${pos.position} of ${pos.total} in the queue for ${target} (waiting ${formatSeconds(pos.waitedSeconds)}).`
}

/** `owner/name` from a GitHub PR URL. */
export function repoFromPrUrl(prUrl: string | null | undefined): string | null {
  const m = prUrl?.match(/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/i)
  return m ? m[1] : null
}

/** Lower-cased `owner/name` plus PR number → id of the report with a fix on that PR. */
export type CiFixLinks = ReadonlyMap<string, string>

export function fixLinkKey(repo: string, prNumber: number): string {
  return `${repo.toLowerCase()}#${prNumber}`
}

/** Map each fix attempt's PR to its report, for "Mushi fix" links on CI jobs. */
export function buildFixLinks(fixes: ReadonlyArray<{ pr_url?: string | null; pr_number?: number | null; report_id: string }>): CiFixLinks {
  const out = new Map<string, string>()
  for (const f of fixes) {
    const repo = repoFromPrUrl(f.pr_url)
    if (!repo || f.pr_number == null) continue
    const key = fixLinkKey(repo, f.pr_number)
    if (!out.has(key)) out.set(key, f.report_id)
  }
  return out
}

// ── Timeline (one lane per runner) ──────────────────────────────────────────

/** @internal Exported for tests only. */
export const NO_RUNNER_LANE = 'No runner yet'
const UNKNOWN_RUNNER_LANE = 'Unknown machine'

export interface CiTimelineBar {
  jobId: string
  jobName: string
  repo: string
  prNumber: number | null
  htmlUrl: string | null
  outcome: CiJobOutcome
  /** Wait segment, clipped to the window (ms since epoch). Null when nothing of it is in view. */
  queue: { start: number; end: number } | null
  /** Run segment, clipped to the window; a running job runs to `now`. */
  run: { start: number; end: number } | null
  waitSeconds: number | null
  runSeconds: number | null
  memPeakMb: number | null
}

interface CiTimelineLane {
  id: string
  label: string
  /** True for the "No runner yet" lane. */
  unassigned: boolean
  /** Run time inside the window, used to order lanes. */
  busyMs: number
  bars: CiTimelineBar[]
}

export interface CiTimeline {
  from: number
  to: number
  lanes: CiTimelineLane[]
}

function clip(start: number, end: number, from: number, to: number): { start: number; end: number } | null {
  const s = Math.max(start, from)
  const e = Math.min(end, to)
  return e > s ? { start: s, end: e } : null
}

/**
 * Lanes and bars for the last `windowMs` before `now`. Wait is created → started
 * (or → finished / now when no runner took it); run is started → completed
 * (or → now while running). Lanes: busiest first, "No runner yet" last.
 */
export function buildCiTimeline(jobs: CiJob[], opts: { now: number; windowMs: number }): CiTimeline {
  const to = opts.now
  const from = to - opts.windowMs
  const lanes = new Map<string, CiTimelineLane>()

  for (const job of jobs) {
    const created = ms(job.createdAt)
    if (created == null) continue
    const started = ms(job.startedAt)
    const completed = ms(job.completedAt)
    const outcome = jobOutcome(job)
    const live = outcome === 'waiting' || outcome === 'running'
    const end = completed ?? (live ? to : started ?? created)
    if (end < from || created > to) continue

    const queueEnd = started ?? end
    const queue = clip(created, queueEnd, from, to)
    const run = started != null ? clip(started, completed ?? (live ? to : started), from, to) : null
    if (!queue && !run) continue

    const unassigned = started == null && !job.runnerName
    const label = job.runnerName ?? (unassigned ? NO_RUNNER_LANE : UNKNOWN_RUNNER_LANE)
    const id = unassigned ? '__none__' : `runner:${label}`
    let lane = lanes.get(id)
    if (!lane) {
      lane = { id, label, unassigned, busyMs: 0, bars: [] }
      lanes.set(id, lane)
    }
    if (run) lane.busyMs += run.end - run.start
    lane.bars.push({
      jobId: job.id,
      jobName: job.jobName,
      repo: job.repo,
      prNumber: job.prNumber,
      htmlUrl: job.htmlUrl,
      outcome,
      queue,
      run,
      waitSeconds: Math.round(((started ?? end) - created) / 1000),
      runSeconds: started != null ? Math.round(((completed ?? (live ? to : started)) - started) / 1000) : null,
      memPeakMb: job.memPeakMb,
    })
  }

  for (const lane of lanes.values()) {
    lane.bars.sort((a, b) => (a.queue?.start ?? a.run?.start ?? 0) - (b.queue?.start ?? b.run?.start ?? 0))
  }
  const ordered = [...lanes.values()].sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1
    if (b.busyMs !== a.busyMs) return b.busyMs - a.busyMs
    return a.label.localeCompare(b.label)
  })
  return { from, to, lanes: ordered }
}

/** Position of `t` in the window as a 0–100 percentage. */
export function timelinePct(t: number, timeline: Pick<CiTimeline, 'from' | 'to'>): number {
  const span = timeline.to - timeline.from
  if (span <= 0) return 0
  return Math.min(100, Math.max(0, ((t - timeline.from) / span) * 100))
}

// ── Overview helpers ────────────────────────────────────────────────────────

/** Nothing to show: no hosts, runners, repos or jobs. */
export function isCiOverviewEmpty(o: Pick<CiOverview, 'hosts' | 'runners' | 'repos' | 'jobs'>): boolean {
  return o.hosts.length === 0 && o.runners.length === 0 && o.repos.length === 0 && o.jobs.length === 0
}

/** The longest finished jobs in the window, longest first. */
export function slowestJobs(jobs: CiJob[], limit = 10): CiJob[] {
  return jobs
    .filter((j) => j.durationSeconds != null && jobOutcome(j) !== 'running' && jobOutcome(j) !== 'waiting')
    .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0))
    .slice(0, limit)
}

/** Infra failures (machine stopped or nobody picked the job up), newest first. */
export function recentInfraFailures(jobs: CiJob[], limit = 10): CiJob[] {
  return jobs
    .filter((j) => j.infra && jobOutcome(j) === 'infra')
    .sort((a, b) => (ms(b.completedAt ?? b.createdAt) ?? 0) - (ms(a.completedAt ?? a.createdAt) ?? 0))
    .slice(0, limit)
}

/** One day of a runner's or machine's finished jobs, by outcome. */
interface CiActivityDay {
  /** UTC day, `YYYY-MM-DD`. */
  day: string
  passed: number
  failed: number
  infra: number
  other: number
}

export interface CiActivity {
  days: CiActivityDay[]
  /** Finished jobs counted in `days`. */
  finished: number
  passRate: number | null
  waitP50s: number | null
  runP50s: number | null
  memPeakMb: number | null
  lastJobAt: string | null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const v = [...values].sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/**
 * Daily outcomes for the jobs a runner (or machine) ran, oldest day first,
 * `days` days ending today (UTC). Live jobs count toward `lastJobAt` only.
 * The overview holds the newest finished jobs, not every one, so callers
 * label this "recent jobs", never a full history.
 */
export function ciActivity(jobs: CiJob[], now: number, days = 7): CiActivity {
  const DAY = 86_400_000
  const today = Math.floor(now / DAY)
  const buckets: CiActivityDay[] = Array.from({ length: days }, (_, i) => ({
    day: new Date((today - days + 1 + i) * DAY).toISOString().slice(0, 10),
    passed: 0,
    failed: 0,
    infra: 0,
    other: 0,
  }))
  let lastJobAt: string | null = null
  let lastMs = -Infinity
  let passed = 0
  let judged = 0
  const waits: number[] = []
  const runs: number[] = []
  let memPeakMb: number | null = null
  let finished = 0
  for (const j of jobs) {
    const at = ms(j.startedAt ?? j.createdAt)
    if (at != null && at > lastMs) {
      lastMs = at
      lastJobAt = j.startedAt ?? j.createdAt
    }
    const outcome = jobOutcome(j)
    if (outcome === 'waiting' || outcome === 'running') continue
    const end = ms(j.completedAt ?? j.startedAt ?? j.createdAt)
    if (end == null) continue
    const idx = Math.floor(end / DAY) - (today - days + 1)
    if (idx < 0 || idx >= days) continue
    finished++
    const b = buckets[idx]
    if (outcome === 'passed') b.passed++
    else if (outcome === 'code_failure') b.failed++
    else if (outcome === 'infra') b.infra++
    else b.other++
    if (outcome === 'passed' || outcome === 'code_failure') {
      judged++
      if (outcome === 'passed') passed++
    }
    if (j.queueSeconds != null) waits.push(j.queueSeconds)
    if (j.durationSeconds != null) runs.push(j.durationSeconds)
    if (j.memPeakMb != null) memPeakMb = Math.max(memPeakMb ?? 0, j.memPeakMb)
  }
  return {
    days: buckets,
    finished,
    passRate: judged ? passed / judged : null,
    waitP50s: median(waits),
    runP50s: median(runs),
    memPeakMb,
    lastJobAt,
  }
}

/** The permissions banner text, or null when Mushi can see everything it needs. */
export function permissionsNotice(p: CiOverview['permissions']): string | null {
  if (p.jobs === 'missing') {
    return 'Mushi cannot read your GitHub Actions jobs. Give the GitHub token Actions: read so Mushi can see where tests run and why they wait.'
  }
  if (p.runners === 'missing') {
    return 'Mushi sees runners only through jobs. Give the GitHub token Administration: read to see idle and offline runners.'
  }
  return null
}
