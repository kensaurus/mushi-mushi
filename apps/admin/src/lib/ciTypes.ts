/**
 * FILE: apps/admin/src/lib/ciTypes.ts
 * PURPOSE: The CI contract the console reads (Plan 022, ADR 0033).
 *
 * Copied from the server's `_shared/ci-overview-types.ts` (the source of
 * truth for `GET /v1/admin/ci/overview`), plus the `fix_attempts.ci_infra`
 * verdict (`_shared/ci-infra.ts`) and the rerun route (`api/routes/ci.ts`).
 * Change the server first, then copy; the console never reshapes them.
 */

type CiJobKind =
  | 'passed'
  | 'skipped'
  | 'running'
  | 'queued'
  | 'waiting_for_runner'
  | 'runner_lost'
  | 'queue_expired'
  | 'cancelled'
  | 'code_failure'

/** Latest infra verdict for a fix attempt's PR head (`fix_attempts.ci_infra`). */
export interface CiInfraVerdict {
  kind: CiJobKind
  infra: boolean
  job: string | null
  runner: string | null
  queuedSeconds: number | null
  detail: string | null
  runId: number | null
  at: string
}

type CiPermission = 'ok' | 'missing' | 'unknown'
export type CiRunnerKind = 'self_hosted' | 'github_hosted' | 'unknown'
export type CiPlatform = 'linux' | 'wsl2' | 'macos' | 'windows'

interface CiHostRunner {
  name: string
  repo: string | null
  service: string | null
  active: boolean
  restarts: number | null
  memCurrentMb: number | null
  memMaxMb: number | null
  oomKills: number | null
}

export interface CiHost {
  hostId: string
  hostname: string
  platform: CiPlatform
  cpuCount: number | null
  memTotalMb: number | null
  lastHeartbeatAt: string
  stale: boolean
  mushiVersion: string | null
  metrics: { load1?: number; memUsedMb?: number; swapUsedMb?: number; swapTotalMb?: number; diskFreeGb?: number }
  runners: CiHostRunner[]
}

interface CiRunner {
  projectId: string
  repo: string
  name: string
  status: 'online' | 'offline' | 'unknown'
  busy: boolean | null
  labels: string[]
  kind: CiRunnerKind
  hostId: string | null
  lastJobAt: string | null
  jobs24h: number
  infraFailures7d: number
}

interface CiRepo {
  projectId: string
  projectName: string
  repo: string
  queued: number
  running: number
  jobs7d: number
  passRate: number | null
  queueP95s: number | null
  durationP50s: number | null
}

export interface CiJob {
  id: string
  projectId: string
  repo: string
  runId: number
  jobId: number
  workflowName: string | null
  jobName: string
  headBranch: string | null
  prNumber: number | null
  status: string
  conclusion: string | null
  ciKind: CiJobKind
  infra: boolean
  infraDetail: string | null
  runnerName: string | null
  runnerKind: CiRunnerKind
  /** The job's runs-on labels: a queued job's say which machine it waits for. */
  labels: string[]
  queueSeconds: number | null
  durationSeconds: number | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  htmlUrl: string | null
  memPeakMb: number | null
}

export interface CiAdvice {
  id: string
  severity: 'high' | 'medium' | 'low'
  title: string
  detail: string
  evidence: string
  fix: string
  repo?: string | null
  runner?: string | null
  hostId?: string | null
  /** Projected saving per 30 days if applied (USD, estimated); null when it cannot be priced. */
  monthSavingUsd?: number | null
  /** Mushi can open a PR that applies this fix (POST /v1/admin/ci/cost-fixes). */
  autofix?: CiCostAutofix | null
}

/** Copy of `CI_COST_FIX_KINDS` in `_shared/ci-overview-types.ts`; change it there first. */
export type CiCostFixKind = 'add_concurrency' | 'skip_drafts' | 'weekly_cron' | 'ignore_docs_paths'

export interface CiCostAutofix {
  kind: CiCostFixKind
  projectId: string
  repo: string
  workflowPath: string
}

interface CiStats {
  jobs: number
  passRate: number | null
  queueP50s: number | null
  queueP95s: number | null
  durationP50s: number | null
  durationP95s: number | null
  infraFailures: number
  codeFailures: number
  byRunner: Array<{ runner: string; jobs: number; busySeconds: number; infraFailures: number; queueP95s: number | null }>
  byWorkflow: Array<{ repo: string; workflow: string; jobs: number; durationP50s: number | null; durationP95s: number | null; failRate: number | null }>
  slowSteps: Array<{ repo: string; job: string; step: string; p50s: number; runs: number }>
}

export interface CiOverview {
  generatedAt: string
  /**
   * When the newest live sync of the scoped projects ran (`refresh=1`, at
   * most once a minute per project); null when none ever ran.
   */
  refreshedAt: string | null
  window: { days: number; from: string }
  permissions: { jobs: CiPermission; runners: CiPermission }
  hosts: CiHost[]
  runners: CiRunner[]
  repos: CiRepo[]
  /** Every queued / in-progress job first (never cut off), then the newest finished jobs, up to 200. */
  jobs: CiJob[]
  stats: CiStats
  advice: CiAdvice[]
}

/** `POST /v1/admin/fixes/:id/ci/rerun` success body (`data`). */
export interface CiRerunResult {
  rerun: Array<{ runId: number }>
  headSha: string
}
