/**
 * FILE: packages/server/supabase/functions/_shared/ci-minutes.ts
 * PURPOSE: Estimate GitHub Actions minutes and list price from job durations
 *          (Plan 019 §1.5, Plan 022 Phase 7).
 *
 * GitHub closed its per-workflow and per-run usage endpoints in 2025, so the
 * minutes are ESTIMATED: Σ jobs ceil((completed − started) / 60 s), at least
 * 1 per completed job (GitHub rounds every job up to a whole minute), priced
 * from the dated rate table below. Jobs on self-hosted runners cost GitHub
 * nothing and are counted apart. Every surface that shows these numbers must
 * say "estimated".
 *
 * `minutes` stays Linux-equivalent (list price ÷ the Linux rate), because
 * spend-ledger.ts prices `ci_workflow_runs.est_billable_minutes` at the Linux
 * rate. The old 1 / 2 / 10 multipliers are gone: the 2026 price ratios are
 * 1 : 1.67 : 10.3.
 *
 * Pure: no I/O.
 */

export type RunnerOs = 'linux' | 'windows' | 'macos'

/**
 * GitHub-hosted standard runner list prices, USD per minute. Recheck monthly;
 * change `fetchedAt` with the numbers.
 */
export const GITHUB_RUNNER_RATES = {
  source: 'https://docs.github.com/en/billing/reference/actions-runner-pricing',
  fetchedAt: '2026-10-22',
  usdPerMinute: { linux: 0.006, windows: 0.01, macos: 0.062 } as Readonly<Record<RunnerOs, number>>,
  /** Linux 2-core arm64 and the 1-core `ubuntu-slim` runner. */
  usdPerMinuteLinuxArm: 0.005,
  usdPerMinuteLinuxSlim: 0.002,
} as const

/** Included minutes per month by GitHub plan (product-billing/github-actions, fetched 2026-10-22). */
export const GITHUB_INCLUDED_MINUTES = { free: 2000, pro: 3000, team: 3000, enterprise: 50000 } as const

/** Price ratio to Linux per OS (Linux 1, Windows ≈ 1.67, macOS ≈ 10.3). */
export const RUNNER_PRICE_RATIO: Readonly<Record<RunnerOs, number>> = {
  linux: 1,
  windows: GITHUB_RUNNER_RATES.usdPerMinute.windows / GITHUB_RUNNER_RATES.usdPerMinute.linux,
  macos: GITHUB_RUNNER_RATES.usdPerMinute.macos / GITHUB_RUNNER_RATES.usdPerMinute.linux,
}

export interface CiJob {
  started_at: string | null
  completed_at: string | null
  labels?: string[]
  runner_name?: string | null
  /** "GitHub Actions" for hosted runners; any other group is self-hosted. */
  runner_group_name?: string | null
}

export interface RunMinutesEstimate {
  /** Linux-equivalent minutes on GitHub-hosted runners (list price ÷ Linux rate). Estimated, never exact. */
  minutes: number
  /** Whole minutes per OS on GitHub-hosted runners (each job rounded up, at least 1). */
  breakdown: Record<RunnerOs, number>
  /** Whole minutes on self-hosted runners: GitHub does not bill them. */
  selfHostedMinutes: number
  /** List price of the GitHub-hosted minutes, USD, before included minutes. */
  listUsd: number
  estimated: true
}

/** The runner OS from the job's labels (or runner name); anything unrecognised is Linux. */
export function runnerOsOf(job: Pick<CiJob, 'labels' | 'runner_name'>): RunnerOs {
  const names = [...(job.labels ?? []), job.runner_name ?? ''].map((l) => l.toLowerCase())
  if (names.some((l) => l.startsWith('macos') || l === 'macos' || l.includes('-macos'))) return 'macos'
  if (names.some((l) => l.startsWith('windows') || l === 'windows' || l.includes('-windows'))) return 'windows'
  return 'linux'
}

/** True when the job ran on a self-hosted runner (a `self-hosted` label, or a runner group other than "GitHub Actions"). */
export function ranSelfHosted(job: Pick<CiJob, 'labels' | 'runner_name' | 'runner_group_name'>): boolean {
  if ((job.labels ?? []).some((l) => l.toLowerCase() === 'self-hosted')) return true
  if (/^GitHub Actions \d+$/i.test(job.runner_name ?? '')) return false
  const group = (job.runner_group_name ?? '').trim().toLowerCase()
  return group !== '' && group !== 'github actions'
}

/** GitHub bills each job in whole minutes, rounded up, at least 1; 0 for a job with no duration (it never ran). */
export function billedMinutesOf(durationSeconds: number | null | undefined): number {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < 0) return 0
  return Math.max(1, Math.ceil(durationSeconds / 60))
}

/** USD per minute for a GitHub-hosted job's labels. */
export function usdPerMinuteFor(job: Pick<CiJob, 'labels' | 'runner_name'>): number {
  const os = runnerOsOf(job)
  if (os !== 'linux') return GITHUB_RUNNER_RATES.usdPerMinute[os]
  const labels = (job.labels ?? []).map((l) => l.toLowerCase())
  if (labels.some((l) => l === 'ubuntu-slim')) return GITHUB_RUNNER_RATES.usdPerMinuteLinuxSlim
  if (labels.some((l) => /^ubuntu-[\w.]+-arm$/.test(l))) return GITHUB_RUNNER_RATES.usdPerMinuteLinuxArm
  return GITHUB_RUNNER_RATES.usdPerMinute.linux
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Minute and list-price estimate for the jobs of one or more runs. Unfinished jobs count 0. */
export function estimateRunMinutes(jobs: readonly CiJob[]): RunMinutesEstimate {
  const breakdown: Record<RunnerOs, number> = { linux: 0, windows: 0, macos: 0 }
  let selfHostedMinutes = 0
  let listUsd = 0
  for (const job of jobs) {
    if (!job.started_at || !job.completed_at) continue
    const start = Date.parse(job.started_at)
    const end = Date.parse(job.completed_at)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const billed = billedMinutesOf(Math.max(0, end - start) / 1000)
    if (ranSelfHosted(job)) {
      selfHostedMinutes += billed
      continue
    }
    breakdown[runnerOsOf(job)] += billed
    listUsd += billed * usdPerMinuteFor(job)
  }
  return {
    minutes: round2(listUsd / GITHUB_RUNNER_RATES.usdPerMinute.linux),
    breakdown,
    selfHostedMinutes,
    listUsd: Math.round(listUsd * 10000) / 10000,
    estimated: true,
  }
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * `minutes_spike`: the last 7 days used more than 2× the median of the
 * previous weeks (the newest 4 entries of `weeklyHistory` are used). With
 * fewer than 2 weeks of history, or a zero median, there is no baseline and
 * the answer is false — never a guess.
 */
export function isMinutesSpike(last7d: number, weeklyHistory: readonly number[]): boolean {
  const weeks = weeklyHistory.filter((n) => Number.isFinite(n) && n >= 0).slice(-4)
  if (weeks.length < 2) return false
  const base = median(weeks)
  if (base <= 0) return false
  return last7d > 2 * base
}

/** One line for a console card, always saying "estimated". */
export function describeMinutes(est: Pick<RunMinutesEstimate, 'minutes'>, days: number): string {
  return `About ${est.minutes} billable minutes in the last ${days} days (estimated from job times).`
}
