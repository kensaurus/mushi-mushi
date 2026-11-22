/**
 * FILE: apps/admin/src/lib/ciView.ts
 * PURPOSE: Pure reads of the CI overview for /ci, the Portfolio card and the
 *          fix loop (Plan 022, ADR 0033): job outcome, the Waiting → Running →
 *          Finished queue, the per-runner timeline, queue position for a PR,
 *          runner families, and plain-words durations. No React, so every
 *          rule is unit-tested.
 */

import type { CiHost, CiJob, CiOverview } from './ciTypes'

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
  code_failure: { label: 'Tests failed', glyph: '✕', tone: 'danger' },
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
/** A CI job's fix: the report to open and the fix attempt to re-run. */
interface CiFixLink {
  reportId: string
  /** Fix attempt id, when the fix list carried one (re-run needs it). */
  fixId: string | null
}

export type CiFixLinks = ReadonlyMap<string, CiFixLink>

export function fixLinkKey(repo: string, prNumber: number): string {
  return `${repo.toLowerCase()}#${prNumber}`
}

/** Map each fix attempt's PR to its report and attempt, for links on CI jobs. */
export function buildFixLinks(fixes: ReadonlyArray<{ id?: string | null; pr_url?: string | null; pr_number?: number | null; report_id: string }>): CiFixLinks {
  const out = new Map<string, CiFixLink>()
  for (const f of fixes) {
    const repo = repoFromPrUrl(f.pr_url)
    if (!repo || f.pr_number == null) continue
    const key = fixLinkKey(repo, f.pr_number)
    if (!out.has(key)) out.set(key, { reportId: f.report_id, fixId: f.id ?? null })
  }
  return out
}

// ── Runner families (one-job runners) ──────────────────────────────────────

/**
 * A one-job (JIT) runner registers a new name for every job:
 * `<base>-<8..13 digits>` or `<base>-<8..13 digits>-<1..6 letters or digits>`
 * (`aw-tsumagoi-1022003316-163`, `mushi-nuc-1761040000`). Short trailing
 * numbers are part of an ordinary name (`alienware-glot-1`). Mirrors the
 * server's `runnerBaseName` (`_shared/ci-infra.ts`); change both together.
 */
const ONE_JOB_RUNNER_RE = /^(.+?)-\d{8,13}(?:-[a-z0-9]{1,6})?$/i

/** The family (base name) of a one-job runner, or null for any other runner name. */
export function runnerFamily(name: string): string | null {
  return ONE_JOB_RUNNER_RE.exec(name)?.[1] ?? null
}

/** The name /ci shows one runner as: a one-job runner's family, else the name itself. */
export function runnerKey(name: string): string {
  return runnerFamily(name) ?? name
}

/** `owner/name` → `name`, for tables where the owner repeats on every row. */
/**
 * The machine a runner runs on: by its `hostId`, else the machine whose heartbeat
 * lists it. `name` is the runner's key (`runnerKey`: a one-job runner's family).
 * The runner map and the CI status board place jobs with this one rule.
 */
export function hostOfRunner(hosts: CiHost[], name: string, hostId: string | null): CiHost | null {
  if (hostId) {
    const byId = hosts.find((h) => h.hostId === hostId)
    if (byId) return byId
  }
  return hosts.find((h) => h.runners.some((r) => runnerKey(r.name) === name)) ?? null
}

export function repoShortName(repo: string): string {
  return repo.split('/').pop() || repo
}

// ── Timeline (one lane per runner) ──────────────────────────────────────────

/** @internal Exported for tests only. */
export const NO_RUNNER_LANE = 'No runner yet'
/** Lane label prefix for GitHub's own machines, one lane per concurrent job. */
const GITHUB_LANE = 'GitHub-hosted'

/**
 * What to call the machine a job ran on. GitHub names its hosted runners
 * "GitHub Actions 1000079285", a throwaway VM id that means nothing to a reader.
 */
export function runnerDisplayName(job: Pick<CiJob, 'runnerName' | 'runnerKind'>): string | null {
  if (job.runnerKind === 'github_hosted') return 'a GitHub-hosted machine'
  return job.runnerName
}
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
  /**
   * `runner` = one named runner; `family` = jobs of one-job runners of one
   * base name, packed like `github` = GitHub's machines; `none` = no runner yet.
   */
  kind: 'runner' | 'family' | 'github' | 'none'
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
 *
 * Throwaway machines get no lane each: GitHub-hosted jobs, and the jobs of
 * one-job runners of one family, are packed into the fewest lanes where no
 * two bars overlap ("GitHub-hosted 2", "aw-tsumagoi 1").
 */
export function buildCiTimeline(jobs: CiJob[], opts: { now: number; windowMs: number }): CiTimeline {
  const to = opts.now
  const from = to - opts.windowMs
  const lanes = new Map<string, CiTimelineLane>()
  // Per packed group (GitHub, or a runner family): when each of its lanes is
  // free again. Jobs come in order of their drawn start (creation), so first
  // fit uses the fewest lanes.
  const packed = new Map<string, number[]>()
  const pack = (group: string, start: number, finish: number): number => {
    const rows = packed.get(group) ?? []
    packed.set(group, rows)
    let row = rows.findIndex((busyUntil) => busyUntil <= start)
    if (row < 0) row = rows.push(0) - 1
    rows[row] = finish
    return row
  }
  const byStart = [...jobs].sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0))

  for (const job of byStart) {
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
    let label = job.runnerName ?? (unassigned ? NO_RUNNER_LANE : UNKNOWN_RUNNER_LANE)
    let id = unassigned ? '__none__' : `runner:${label}`
    let kind: CiTimelineLane['kind'] = unassigned ? 'none' : 'runner'
    // One lane per job running at the same time, not one per throwaway machine.
    const start = (queue ?? run)!.start
    const finish = (run ?? queue)!.end
    const family = !unassigned && job.runnerKind !== 'github_hosted' && job.runnerName ? runnerFamily(job.runnerName) : null
    if (!unassigned && job.runnerKind === 'github_hosted') {
      const row = pack('github', start, finish)
      label = `${GITHUB_LANE} ${row + 1}`
      id = `github:${row}`
      kind = 'github'
    } else if (family) {
      const row = pack(`family:${family}`, start, finish)
      label = `${family} ${row + 1}`
      id = `family:${family}:${row}`
      kind = 'family'
    }
    let lane = lanes.get(id)
    if (!lane) {
      lane = { id, label, kind, unassigned, busyMs: 0, bars: [] }
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

  // A lone packed lane needs no number, unless a runner lane has that name.
  const taken = new Set([...lanes.values()].filter((l) => l.kind === 'runner').map((l) => l.label))
  for (const [group, rows] of packed) {
    if (rows.length !== 1) continue
    const only = lanes.get(group === 'github' ? 'github:0' : `${group}:0`)
    const name = group === 'github' ? GITHUB_LANE : group.slice('family:'.length)
    if (only && !taken.has(name)) only.label = name
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

/** Below this many lanes nothing is folded: the whole timeline already fits. */
const QUIET_FOLD_MIN_LANES = 8
/** Folding one lane behind a button saves nothing. */
const QUIET_FOLD_MIN_QUIET = 2
const QUIET_OUTCOMES: ReadonlySet<CiJobOutcome> = new Set(['passed', 'cancelled'])

/**
 * Splits off "quiet" machines: at most one job in the window, and that job passed or was
 * cancelled. A lane with a failure, a stopped job, or a job running or waiting is never quiet,
 * and neither is "No runner yet": those are the lanes the timeline is for. A GitHub-hosted lane
 * always shows too: a job there is billed minutes, the thing an owner on their own runners
 * wants to catch. On a busy day 9 of 17 lanes held one green bar each and pushed the busy
 * runners apart (2026-11-17).
 * Order is kept; nothing is folded unless it saves at least two rows on a long timeline.
 */
export function splitQuietLanes<L extends Pick<CiTimelineLane, 'unassigned' | 'bars' | 'kind'>>(lanes: L[]): { shown: L[]; quiet: L[] } {
  const isQuiet = (l: L) =>
    !l.unassigned && l.kind !== 'github' && l.bars.length <= 1 && l.bars.every((b) => QUIET_OUTCOMES.has(b.outcome))
  const quiet = lanes.filter(isQuiet)
  if (lanes.length < QUIET_FOLD_MIN_LANES || quiet.length < QUIET_FOLD_MIN_QUIET) return { shown: lanes, quiet: [] }
  return { shown: lanes.filter((l) => !isQuiet(l)), quiet }
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
  /** False before the oldest job Mushi holds: no data, not zero jobs. */
  covered: boolean
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
export function ciActivity(jobs: CiJob[], now: number, days = 7, coveredFrom: number | null = null): CiActivity {
  const DAY = 86_400_000
  const today = Math.floor(now / DAY)
  const buckets: CiActivityDay[] = Array.from({ length: days }, (_, i) => ({
    day: new Date((today - days + 1 + i) * DAY).toISOString().slice(0, 10),
    covered: coveredFrom == null || (today - days + 2 + i) * DAY > coveredFrom,
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
    // One repo without Actions: read used to make this read as if no job could be
    // read (2026-11-07: only solo-boss-cloud_backend, of ten repos). Name them.
    const repos = (p.jobsMissingRepos ?? []).map((r) => r.split('/').pop() ?? r)
    if (repos.length > 0) {
      const list = repos.length > 3 ? `${repos.slice(0, 3).join(', ')} and ${repos.length - 3} more` : repos.join(', ')
      return `Mushi Mushi cannot read GitHub Actions jobs for ${list}, so its jobs are missing below. Give that repo's GitHub token Actions: read.`
    }
    return 'Mushi Mushi cannot read your GitHub Actions jobs. Give the GitHub token Actions: read so Mushi Mushi can see where tests run and why they wait.'
  }
  if (p.runners === 'missing') {
    // The machines that report in are listed (their own heartbeat); only GitHub's list of runners
    // that are idle or offline right now is out of reach (2026-11-18: the old line said "idle
    // machines are missing" right above two idle machines).
    return 'GitHub lists a runner to Mushi Mushi only while it runs a job. Machines that report in show below either way; to also see idle or offline runners on GitHub, give the GitHub token “Administration: read”.'
  }
  return null
}

// ── Summary (top of /ci) ────────────────────────────────────────────────────

/** Finished jobs by outcome over the window, from the server's stats. */
export interface CiOutcomeCounts {
  passed: number
  codeFailures: number
  infra: number
  /** Cancelled, skipped, or still waiting or running. */
  other: number
  total: number
}

/**
 * Outcome counts for the summary bar. `passed` is jobs that finished testing
 * and passed. Machine stops stay in `infra`: they never finished testing, so
 * they are not folded into the pass rate.
 * @internal Exported for tests.
 */
export function ciOutcomeCounts(stats: Pick<CiOverview['stats'], 'jobs' | 'passed' | 'infraFailures' | 'codeFailures'>): CiOutcomeCounts {
  const failed = stats.codeFailures + stats.infraFailures
  const passed = Math.min(Math.max(0, stats.passed), Math.max(0, stats.jobs - failed))
  return {
    passed,
    codeFailures: stats.codeFailures,
    infra: stats.infraFailures,
    other: Math.max(0, stats.jobs - passed - failed),
    total: stats.jobs,
  }
}

/**
 * The window's outcome counts, from ONE source (2026-11-18: the headline said "777 jobs failed on
 * the code in 7 days" from the whole window while the bar beside it said "Tests failed 67" from
 * the newest 1,005 jobs read). When the server counted the whole window (stats.windowJobs and
 * stats.hourly) every number comes from there; otherwise from the jobs read, flagged `sampled`.
 */
export function ciWindowCounts(stats: Pick<CiOverview['stats'], 'jobs' | 'passed' | 'infraFailures' | 'codeFailures' | 'hourly' | 'windowJobs'>): CiOutcomeCounts & { sampled: boolean } {
  const read = ciOutcomeCounts(stats)
  if (stats.windowJobs == null || !stats.hourly) return { ...read, sampled: false }
  const sum = (k: 'passed' | 'codeFailures' | 'infraFailures') => stats.hourly!.reduce((n, h) => n + h[k], 0)
  const codeFailures = sum('codeFailures')
  const infra = sum('infraFailures')
  const total = Math.max(stats.windowJobs, codeFailures + infra)
  const passed = Math.min(sum('passed'), total - codeFailures - infra)
  return { passed, codeFailures, infra, other: Math.max(0, total - passed - codeFailures - infra), total, sampled: false }
}

export interface CiVerdict {
  tone: 'ok' | 'warn' | 'danger' | 'neutral'
  headline: string
  detail: string
}

/**
 * One plain sentence for the CI page's "Last 7 days": does the week need you, and what.
 * The live queue (running, waiting) is the status board's, right above it: repeating
 * "3 jobs are waiting" here said the same thing twice (2026-11-16).
 */
export function ciVerdict(o: Pick<CiOverview, 'stats' | 'window'>): CiVerdict {
  // The same counts the bar under it draws (ciWindowCounts), so the two never disagree.
  const c = ciWindowCounts(o.stats)
  const days = `${o.window.days} day${o.window.days === 1 ? '' : 's'}`

  if (c.infra > 0 && c.infra >= c.codeFailures) {
    return {
      tone: 'warn',
      headline: 'Most failures are the test machine, not your code.',
      detail: `${c.infra} of ${c.infra + c.codeFailures} failed jobs in ${days} never finished testing. Re-run them; "Speed it up" below says why the machine stops.`,
    }
  }
  if (c.codeFailures > 0) {
    return {
      tone: 'neutral',
      headline: `${c.codeFailures} job${c.codeFailures === 1 ? '' : 's'} failed on the code in ${days}.`,
      detail: `${c.infra ? `${c.infra} more in ${days} stopped because of the test machine. ` : ''}Open a failed job's logs, or its fix to send it back.`,
    }
  }
  return {
    tone: 'ok',
    headline: c.total ? `CI is healthy: every finished job passed in ${days}.` : `No jobs in ${days}.`,
    detail: `${c.total ? `${c.total} job${c.total === 1 ? '' : 's'}.` : ''}`.trim(),
  }
}

// ── Grouping helpers (fresh-eyes pass, 2026-11-18) ──────────────────────────

/** "Browser gates (2/4)" → "Browser gates": the shard suffix GitHub adds to a matrix job. */
function shardBase(job: string): string {
  return job.replace(/\s*\(\d+\s*\/\s*\d+\)\s*$/, '')
}

/** One slow step, with the matrix shards of one job folded into one row. */
export interface CiSlowStepGroup {
  repo: string
  /** The job without its shard suffix. */
  job: string
  step: string
  /** The slowest shard's typical time. */
  p50s: number
  /** Runs across every shard. */
  runs: number
  /** How many shards share this row (1 = not a matrix job). */
  shards: number
}

/**
 * Folds the shards of a matrix job ("Browser gates (1/4)" … "(4/4)") that share a step into one
 * row: the slowest shard's time, every shard's runs. Slowest first.
 */
export function groupSlowSteps(steps: ReadonlyArray<{ repo: string; job: string; step: string; p50s: number; runs: number }>): CiSlowStepGroup[] {
  const out = new Map<string, CiSlowStepGroup>()
  for (const s of steps) {
    const job = shardBase(s.job)
    const key = `${s.repo}|${job}|${s.step}`
    const cur = out.get(key)
    if (cur) {
      cur.p50s = Math.max(cur.p50s, s.p50s)
      cur.runs += s.runs
      cur.shards += 1
    } else out.set(key, { repo: s.repo, job, step: s.step, p50s: s.p50s, runs: s.runs, shards: 1 })
  }
  return [...out.values()].sort((a, b) => b.p50s - a.p50s)
}

/**
 * GitHub's machines are packed into lanes "GitHub-hosted 1 … 10" that read as near-identical rows.
 * The first GitHub lane and every one with a failure stay; the other clean ones fold into one
 * summary row (`rest`) once that saves at least two rows. Order is kept.
 */
/** A lane with a job running or waiting for a machine right now. */
export const laneIsLive = (l: { bars: ReadonlyArray<{ outcome: string }> }): boolean =>
  l.bars.some((b) => b.outcome === 'running' || b.outcome === 'waiting')

export function foldGithubLanes<L extends Pick<CiTimelineLane, 'kind' | 'bars'>>(lanes: readonly L[]): { shown: L[]; rest: L[] } {
  const failed = (l: L) => l.bars.some((b) => b.outcome === 'code_failure' || b.outcome === 'infra')
  // A lane with a job running now never folds away: what is live stays on screen.
  const clean = lanes.filter((l) => l.kind === 'github' && !failed(l) && !laneIsLive(l))
  if (clean.length < 3) return { shown: [...lanes], rest: [] }
  const rest = new Set(clean.slice(1))
  return { shown: lanes.filter((l) => !rest.has(l)), rest: clean.slice(1) }
}

/** Where an app's jobs ran in the window: your machines, GitHub's, both, or no job seen. */
export type CiRunsOn = 'own' | 'github' | 'both' | null

export function appRunsOn(jobs: ReadonlyArray<Pick<CiJob, 'projectId' | 'runnerKind'>>): Map<string, CiRunsOn> {
  const seen = new Map<string, { own: boolean; github: boolean }>()
  for (const j of jobs) {
    if (j.runnerKind === 'unknown') continue
    const s = seen.get(j.projectId) ?? { own: false, github: false }
    if (j.runnerKind === 'self_hosted') s.own = true
    else s.github = true
    seen.set(j.projectId, s)
  }
  const out = new Map<string, CiRunsOn>()
  for (const [id, s] of seen) out.set(id, s.own && s.github ? 'both' : s.own ? 'own' : 'github')
  return out
}

/** Jobs the test machine stopped, grouped by app and PR (or branch), newest group first. */
export interface CiInfraGroup {
  key: string
  repo: string
  prNumber: number | null
  jobs: CiJob[]
}

export function groupInfraFailures(jobs: readonly CiJob[]): CiInfraGroup[] {
  const out = new Map<string, CiInfraGroup>()
  for (const j of jobs) {
    const key = `${j.repo}|${j.prNumber ?? 'none'}`
    const g = out.get(key)
    if (g) g.jobs.push(j)
    else out.set(key, { key, repo: j.repo, prNumber: j.prNumber ?? null, jobs: [j] })
  }
  return [...out.values()]
}

/**
 * A job name without the workflow expression GitHub left unresolved (round 3, 2026-11-19: "Publish
 * OTA (${{ (((inputs.track == 'beta') && 'beta') || 'production') }})"). A bracketed expression goes
 * with its brackets; one inside the name becomes "…". The real name is never lost: an all-expression
 * name stays as it was.
 * @internal Exported for tests.
 */
export function cleanJobName(name: string): string {
  if (!name.includes('${{')) return name
  const out = name
    .replace(/\s*\(\s*\$\{\{[\s\S]*?\}\}\s*\)/g, '')
    .replace(/\$\{\{[\s\S]*?\}\}/g, '…')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return out || name
}

/** The overview with every job name cleaned (cleanJobName), once, where the page reads it. */
export function cleanCiOverview(o: CiOverview): CiOverview {
  const dirty = (n: string | null | undefined) => typeof n === 'string' && n.includes('${{')
  const hasDirty =
    o.jobs.some((j) => dirty(j.jobName)) ||
    (o.stats.byJob ?? []).some((t) => dirty(t.job)) ||
    o.stats.slowSteps.some((s) => dirty(s.job))
  if (!hasDirty) return o
  return {
    ...o,
    jobs: o.jobs.map((j) => (dirty(j.jobName) ? { ...j, jobName: cleanJobName(j.jobName) } : j)),
    stats: {
      ...o.stats,
      slowSteps: o.stats.slowSteps.map((s) => (dirty(s.job) ? { ...s, job: cleanJobName(s.job) } : s)),
      ...(o.stats.byJob ? { byJob: o.stats.byJob.map((t) => (dirty(t.job) ? { ...t, job: cleanJobName(t.job) } : t)) } : {}),
    },
  }
}
