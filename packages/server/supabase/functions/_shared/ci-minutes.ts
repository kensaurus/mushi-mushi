/**
 * FILE: packages/server/supabase/functions/_shared/ci-minutes.ts
 * PURPOSE: Estimate GitHub Actions minutes from job durations (Plan 019 §1.5).
 *
 * GitHub closed its per-workflow and per-run usage endpoints in 2025, so the
 * minutes are ESTIMATED: Σ jobs ceil((completed − started) / 60 s), at least
 * 1 per completed job, × the runner multiplier (Linux 1, Windows 2, macOS 10).
 * Every surface that shows these numbers must say "estimated".
 *
 * Pure: no I/O.
 */

export type RunnerOs = 'linux' | 'windows' | 'macos'

export const RUNNER_MULTIPLIER: Readonly<Record<RunnerOs, number>> = { linux: 1, windows: 2, macos: 10 }

export interface CiJob {
  started_at: string | null
  completed_at: string | null
  labels?: string[]
  runner_name?: string | null
}

export interface RunMinutesEstimate {
  /** Billable minutes after the runner multiplier. Estimated, never exact. */
  minutes: number
  /** Raw (pre-multiplier) minutes per runner OS. */
  breakdown: Record<RunnerOs, number>
  estimated: true
}

/** The runner OS from the job's labels (or runner name); anything unrecognised is Linux. */
export function runnerOsOf(job: Pick<CiJob, 'labels' | 'runner_name'>): RunnerOs {
  const names = [...(job.labels ?? []), job.runner_name ?? ''].map((l) => l.toLowerCase())
  if (names.some((l) => l.startsWith('macos') || l === 'macos' || l.includes('-macos'))) return 'macos'
  if (names.some((l) => l.startsWith('windows') || l === 'windows' || l.includes('-windows'))) return 'windows'
  return 'linux'
}

/** Billable-minute estimate for the jobs of one or more runs. Unfinished jobs count 0. */
export function estimateRunMinutes(jobs: readonly CiJob[]): RunMinutesEstimate {
  const breakdown: Record<RunnerOs, number> = { linux: 0, windows: 0, macos: 0 }
  for (const job of jobs) {
    if (!job.started_at || !job.completed_at) continue
    const start = Date.parse(job.started_at)
    const end = Date.parse(job.completed_at)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const raw = Math.max(1, Math.ceil(Math.max(0, end - start) / 60_000))
    breakdown[runnerOsOf(job)] += raw
  }
  const minutes =
    breakdown.linux * RUNNER_MULTIPLIER.linux +
    breakdown.windows * RUNNER_MULTIPLIER.windows +
    breakdown.macos * RUNNER_MULTIPLIER.macos
  return { minutes, breakdown, estimated: true }
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
