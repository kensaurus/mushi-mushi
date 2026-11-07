/**
 * FILE: apps/admin/src/lib/ciAttention.ts
 * PURPOSE: What on the CI page needs a person now (2026-11-07; the owner: "how can I see what is
 *          running now, what is stuck, what is errored, the mean completion time, the long runs").
 *
 *   runningLong   — running jobs past their own job type's usual time (p90, and twice the median)
 *   recentFailed  — jobs that failed in the last two hours: tests failed, or the machine stopped
 *   waitingByRepo — the queue per repo: how many, how long the oldest waits, which jobs
 *
 * Usual times come from the server's stats.byJob (one row per repo + workflow + job name), the
 * same breakdown GitHub's Actions performance metrics and Buildkite's queue insights use.
 */

import type { CiJob, CiJobType } from './ciTypes'
import { jobElapsedSeconds, jobOutcome } from './ciView'

/** A job type needs this many runs before "usual" means anything. */
const MIN_RUNS_FOR_TYPICAL = 3
/** Grace on top of the usual time, so a job a few seconds over is not flagged. */
const LONG_RUN_GRACE_S = 60
/** "Failed recently" window. */
const RECENT_FAILED_WINDOW_MS = 2 * 60 * 60 * 1000

function jobTypeKey(j: { repo: string; workflowName?: string | null; workflow?: string; jobName?: string; job?: string }): string {
  return `${j.repo}|${j.workflowName ?? j.workflow ?? '(unnamed)'}|${j.jobName ?? j.job ?? ''}`
}

interface RunningLong {
  job: CiJob
  elapsedS: number
  typicalS: number
  p90S: number
  /** elapsed ÷ typical (median). */
  ratio: number
}

/**
 * Running jobs past max(p90, 2 × median) + a minute for their own job type, longest overrun first.
 * A type with fewer than three runs has no usual time, so its jobs are never flagged.
 */
export function runningLong(jobs: CiJob[], byJob: CiJobType[] | undefined, now: number): RunningLong[] {
  const types = new Map((byJob ?? []).map((t) => [jobTypeKey(t), t]))
  const out: RunningLong[] = []
  for (const job of jobs) {
    if (jobOutcome(job) !== 'running') continue
    const elapsedS = jobElapsedSeconds(job, now)
    const t = types.get(jobTypeKey(job))
    if (elapsedS == null || !t || t.runs < MIN_RUNS_FOR_TYPICAL || t.durationP50s == null || t.durationP90s == null) continue
    const limit = Math.max(t.durationP90s, 2 * t.durationP50s) + LONG_RUN_GRACE_S
    if (elapsedS > limit) out.push({ job, elapsedS, typicalS: t.durationP50s, p90S: t.durationP90s, ratio: elapsedS / Math.max(1, t.durationP50s) })
  }
  return out.sort((a, b) => b.ratio - a.ratio)
}

interface RecentFailure {
  job: CiJob
  /** code: tests failed · machine: the machine died mid-job · waited: cancelled before any machine took it. */
  kind: 'code' | 'machine' | 'waited'
  /** Plain reason: GitHub's message for a machine stop, else "Tests failed". */
  reason: string
  at: number
}

/** Tests failed or the machine stopped, in the last two hours, newest first. */
export function recentFailed(jobs: CiJob[], now: number, windowMs = RECENT_FAILED_WINDOW_MS): RecentFailure[] {
  const out: RecentFailure[] = []
  for (const job of jobs) {
    const outcome = jobOutcome(job)
    if (outcome !== 'code_failure' && outcome !== 'infra') continue
    const at = Date.parse(job.completedAt ?? job.startedAt ?? job.createdAt ?? '')
    if (!Number.isFinite(at) || now - at > windowMs) continue
    // A stop with no runner never reached a machine (cancelled while waiting): not a machine fault.
    const kind: RecentFailure['kind'] = outcome === 'code_failure' ? 'code' : job.runnerName ? 'machine' : 'waited'
    out.push({
      job,
      kind,
      reason:
        kind === 'code'
          ? 'Tests failed'
          : job.infraDetail?.trim() || (kind === 'machine' ? 'The test machine stopped before the job finished.' : 'Cancelled before a machine took it.'),
      at,
    })
  }
  return out.sort((a, b) => b.at - a.at)
}

interface RepoWaiting {
  repo: string
  count: number
  oldestS: number
  medianS: number
  /** Most-waiting job names first, at most three. */
  topJobs: Array<{ name: string; count: number }>
}

/** Waiting jobs per repo, the repo with the oldest wait first. */
export function waitingByRepo(jobs: CiJob[], now: number): RepoWaiting[] {
  const byRepo = new Map<string, number[]>()
  const names = new Map<string, Map<string, number>>()
  for (const job of jobs) {
    if (jobOutcome(job) !== 'waiting') continue
    const waited = jobElapsedSeconds(job, now) ?? 0
    const list = byRepo.get(job.repo) ?? []
    list.push(waited)
    byRepo.set(job.repo, list)
    const n = names.get(job.repo) ?? new Map<string, number>()
    n.set(job.jobName, (n.get(job.jobName) ?? 0) + 1)
    names.set(job.repo, n)
  }
  return [...byRepo.entries()]
    .map(([repo, waits]) => {
      const sorted = [...waits].sort((a, b) => a - b)
      return {
        repo,
        count: waits.length,
        oldestS: sorted[sorted.length - 1] ?? 0,
        medianS: sorted[Math.floor((sorted.length - 1) / 2)] ?? 0,
        topJobs: [...(names.get(repo) ?? new Map<string, number>()).entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([name, count]) => ({ name, count })),
      }
    })
    .sort((a, b) => b.oldestS - a.oldestS)
}
