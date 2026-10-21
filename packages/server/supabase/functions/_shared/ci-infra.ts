/**
 * FILE: packages/server/supabase/functions/_shared/ci-infra.ts
 * PURPOSE: Is the fix broken, or is the test machine? (Plan 022, ADR 0033.)
 *          One verdict per GitHub Actions job, from the REST job shape (or
 *          the `workflow_job` webhook's, which is the same) plus the check
 *          run's annotations.
 *
 * REGRESSION (2026-10-21, glot.it): the self-hosted runner
 * kensaurus-local-glot-1 was OOM-killed mid-build. GitHub cancelled the job
 * and Mushi called it "CI failed" everywhere: the console, the Opus review
 * (which held the merge) and a follow-up agent sent to fix CI that never
 * ran. No job field says why a job was cancelled; the check run's
 * annotation does ("lost communication with the server").
 *
 * Kinds:
 *   passed / skipped / running / queued   — nothing to report
 *   waiting_for_runner  queued ≥ 10 min on a self-hosted (or any custom)
 *                       label, ≥ 30 min on GitHub-hosted labels      infra
 *   runner_lost         ran on a runner, then the runner died (annotation
 *                       says lost communication / shutdown signal, or
 *                       steps ran but GitHub kept no runner name)    infra
 *   queue_expired       cancelled before any runner picked it up, after
 *                       waiting as long as waiting_for_runner needs  infra
 *   cancelled           cancelled for another reason (superseded by a
 *                       newer push, cancelled by a person)
 *   code_failure        failure / timed_out on a live runner
 *
 * GitHub sets `started_at` on jobs that never ran (a superseded queued job
 * reads started_at = created_at, runner_name null, no steps), so "started"
 * here means a runner took the job: a runner name or id, or a step that
 * started. A queued job cancelled within minutes was superseded, not
 * stranded, so it stays plain `cancelled`.
 *
 * Pure: no imports, no env, no I/O.
 */

export type CiJobKind =
  | 'passed'
  | 'skipped'
  | 'running'
  | 'queued'
  | 'waiting_for_runner'
  | 'runner_lost'
  | 'queue_expired'
  | 'cancelled'
  | 'code_failure'

/** Every kind, in the order the ci_jobs CHECK constraint lists them. */
export const CI_JOB_KINDS: readonly CiJobKind[] = [
  'passed',
  'skipped',
  'running',
  'queued',
  'waiting_for_runner',
  'runner_lost',
  'queue_expired',
  'cancelled',
  'code_failure',
]

/** The kinds that are the machine's fault, not the code's. */
export const CI_INFRA_KINDS: ReadonlySet<CiJobKind> = new Set(['waiting_for_runner', 'runner_lost', 'queue_expired'])

export type CiRunnerKind = 'self_hosted' | 'github_hosted' | 'unknown'

/** The fields of a GitHub job this file reads (REST `jobs[]` or webhook `workflow_job`). */
export interface CiJobInput {
  status?: string | null
  conclusion?: string | null
  created_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  runner_id?: number | null
  runner_name?: string | null
  labels?: readonly string[] | null
  steps?: ReadonlyArray<{ status?: string | null; started_at?: string | null }> | null
}

export interface CiJobVerdict {
  kind: CiJobKind
  infra: boolean
  runner: string | null
  queuedSeconds: number | null
  durationSeconds: number | null
  detail: string | null
}

/** A self-hosted job waits this long before Mushi calls it stranded. */
export const SELF_HOSTED_WAIT_S = 10 * 60
/** GitHub-hosted runners can queue at peak; give them longer. */
export const GITHUB_HOSTED_WAIT_S = 30 * 60
/** GitHub cancels a job no runner picked up after 24 h. */
export const QUEUE_EXPIRY_S = 23 * 60 * 60

/** The annotation GitHub writes when the runner process died or was stopped mid-job. */
export const RUNNER_LOST_RE =
  /lost communication with the server|received a shutdown signal|runner has received a shutdown/i

const GITHUB_HOSTED_LABEL_RE = /^(?:ubuntu|windows|macos)-[\w.-]+$/i

/**
 * Where a job ran, from its labels (and runner name): `self-hosted` →
 * self_hosted; only ubuntu-* / windows-* / macos-* labels, or a runner named
 * "GitHub Actions N" → github_hosted; anything else → unknown (a larger
 * GitHub runner and a custom-labelled machine look alike).
 */
export function runnerKindOf(job: Pick<CiJobInput, 'labels' | 'runner_name'>): CiRunnerKind {
  const labels = (job.labels ?? []).map((l) => String(l).trim()).filter(Boolean)
  if (labels.some((l) => l.toLowerCase() === 'self-hosted')) return 'self_hosted'
  if (labels.length > 0 && labels.every((l) => GITHUB_HOSTED_LABEL_RE.test(l))) return 'github_hosted'
  if (/^GitHub Actions \d+$/i.test(job.runner_name ?? '')) return 'github_hosted'
  return 'unknown'
}

/** How long a queued job may wait before it is `waiting_for_runner`. */
export function waitThresholdSeconds(job: Pick<CiJobInput, 'labels'>): number {
  const labels = (job.labels ?? []).map((l) => String(l).trim()).filter(Boolean)
  if (labels.length === 0) return GITHUB_HOSTED_WAIT_S
  return labels.every((l) => GITHUB_HOSTED_LABEL_RE.test(l)) ? GITHUB_HOSTED_WAIT_S : SELF_HOSTED_WAIT_S
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

function seconds(from: number | null, to: number | null): number | null {
  if (from == null || to == null) return null
  return Math.max(0, Math.round((to - from) / 1000))
}

function minutes(s: number): string {
  if (s < 90 * 60) return `${Math.max(1, Math.round(s / 60))} min`
  return `${Math.round((s / 3600) * 10) / 10} h`
}

/** A runner took the job: it has a runner, or one of its steps started. */
export function runnerTookJob(job: CiJobInput): boolean {
  const name = (job.runner_name ?? '').trim()
  if (name) return true
  if (typeof job.runner_id === 'number' && job.runner_id > 0) return true
  return (job.steps ?? []).some((s) => Boolean(s.started_at) && (s.status ?? '') !== 'queued')
}

export function classifyCiJob(
  job: CiJobInput,
  opts: { annotations?: readonly string[] | null; now: Date },
): CiJobVerdict {
  const now = opts.now.getTime()
  const status = (job.status ?? '').toLowerCase()
  const conclusion = (job.conclusion ?? '').toLowerCase()
  const runner = (job.runner_name ?? '').trim() || null
  const created = ms(job.created_at)
  const took = runnerTookJob(job)
  const started = took ? ms(job.started_at) ?? created : null
  const completed = ms(job.completed_at)
  const threshold = waitThresholdSeconds(job)
  const queuedSeconds = took ? seconds(created, started) : seconds(created, completed ?? now)
  const durationSeconds = took && completed != null ? seconds(started, completed) : null
  const verdict = (kind: CiJobKind, detail: string | null = null): CiJobVerdict => ({
    kind,
    infra: CI_INFRA_KINDS.has(kind),
    runner,
    queuedSeconds,
    durationSeconds,
    detail,
  })

  // Not finished yet.
  if (status !== 'completed' || !conclusion) {
    if (status === 'in_progress') return verdict('running')
    // 'waiting' is an environment approval, not a missing runner.
    if (status === 'waiting') return verdict('queued', 'Waiting for a deployment approval.')
    const waited = seconds(created, now) ?? 0
    if (waited >= threshold) {
      return verdict('waiting_for_runner', `Queued ${minutes(waited)} with no runner picking it up.`)
    }
    return verdict('queued')
  }

  if (conclusion === 'success' || conclusion === 'neutral') return verdict('passed')
  if (conclusion === 'skipped') return verdict('skipped')

  const lostNote = (opts.annotations ?? []).find((a) => RUNNER_LOST_RE.test(a)) ?? null
  if ((conclusion === 'cancelled' || conclusion === 'failure') && took) {
    if (lostNote) return verdict('runner_lost', lostNote.trim().slice(0, 300))
    if (!runner) return verdict('runner_lost', 'The job started, then GitHub lost track of its runner.')
  }

  if (conclusion === 'cancelled' || conclusion === 'stale') {
    if (!took) {
      const waited = queuedSeconds ?? 0
      if (waited >= QUEUE_EXPIRY_S) {
        return verdict('queue_expired', `No runner picked this job up in ${minutes(waited)}; GitHub cancelled it.`)
      }
      if (waited >= threshold) {
        return verdict('queue_expired', `Cancelled after ${minutes(waited)} waiting for a runner.`)
      }
    }
    return verdict('cancelled')
  }

  if (conclusion === 'action_required') return verdict('code_failure', 'GitHub needs someone to approve this run.')
  // failure, timed_out, startup_failure and anything unknown: the code or the workflow.
  return verdict('code_failure', conclusion === 'timed_out' ? 'The job ran past its time limit.' : null)
}

/** One verdict for a set of jobs (a run, or every run on a PR head). */
export type CiRunKind = CiJobKind | 'none'

/**
 * Worst first. A code failure wins over an infra verdict (the code is broken
 * whatever the machine did); an infra verdict wins over a plain cancel (the
 * superseded sibling of a lost job does not hide the lost one).
 */
const RUN_PRIORITY: readonly CiJobKind[] = [
  'code_failure',
  'runner_lost',
  'queue_expired',
  'waiting_for_runner',
  'cancelled',
  'running',
  'queued',
  'passed',
  'skipped',
]

export interface CiRunSummary<T extends CiJobVerdict = CiJobVerdict> {
  kind: CiRunKind
  infra: boolean
  /** Number of jobs summarized. */
  jobs: number
  counts: Partial<Record<CiJobKind, number>>
  /** The job that decided `kind` (the first one of that kind), or null for no jobs. */
  worst: T | null
}

export function summarizeCiJobs<T extends CiJobVerdict>(verdicts: readonly T[]): CiRunSummary<T> {
  const counts: Partial<Record<CiJobKind, number>> = {}
  for (const v of verdicts) counts[v.kind] = (counts[v.kind] ?? 0) + 1
  for (const kind of RUN_PRIORITY) {
    if (!counts[kind]) continue
    const worst = verdicts.find((v) => v.kind === kind) ?? null
    return { kind, infra: CI_INFRA_KINDS.has(kind), jobs: verdicts.length, counts, worst }
  }
  return { kind: 'none', infra: false, jobs: verdicts.length, counts, worst: null }
}

/** What `fix_attempts.ci_infra` holds: the latest verdict for the attempt's PR head. */
export interface FixCiInfra {
  kind: CiRunKind
  infra: boolean
  job: string | null
  runner: string | null
  queuedSeconds: number | null
  detail: string | null
  runId: number | null
  at: string
}

/** Read a stored `fix_attempts.ci_infra` defensively (it is jsonb). */
export function readFixCiInfra(value: unknown): FixCiInfra | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const kind = typeof v.kind === 'string' && ((CI_JOB_KINDS as readonly string[]).includes(v.kind) || v.kind === 'none')
    ? (v.kind as CiRunKind)
    : null
  if (!kind) return null
  return {
    kind,
    infra: v.infra === true && CI_INFRA_KINDS.has(kind as CiJobKind),
    job: typeof v.job === 'string' ? v.job : null,
    runner: typeof v.runner === 'string' ? v.runner : null,
    queuedSeconds: typeof v.queuedSeconds === 'number' ? v.queuedSeconds : null,
    detail: typeof v.detail === 'string' ? v.detail : null,
    runId: typeof v.runId === 'number' ? v.runId : null,
    at: typeof v.at === 'string' ? v.at : '',
  }
}

/** Plain words for an infra verdict, for the fix loop and the review prompt. */
export function describeCiInfra(ci: Pick<FixCiInfra, 'kind' | 'runner'>): string {
  const on = ci.runner ? ` on ${ci.runner}` : ''
  switch (ci.kind) {
    case 'runner_lost':
      return `runner lost${on}`
    case 'queue_expired':
      return 'no runner picked the job up'
    case 'waiting_for_runner':
      return 'waiting for a runner'
    default:
      return ci.kind.replace(/_/g, ' ')
  }
}

/**
 * One-job (JIT) runners register as `<label>-<unix seconds>` (`mushi runner
 * add`), so every job is a new runner name. The base name is what a host
 * heartbeat lists and what the map shows as one runner.
 */
export function runnerBaseName(name: string): string {
  return name.replace(/-\d{9,}$/, '')
}

/** True when a GitHub runner name is the heartbeat's runner, or a one-job runner of it. */
export function runnerNameMatches(heartbeatName: string, githubName: string): boolean {
  return githubName === heartbeatName || runnerBaseName(githubName) === heartbeatName
}

