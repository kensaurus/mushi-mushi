/**
 * FILE: apps/admin/src/lib/ciTypes.ts
 * PURPOSE: The CI contract the console reads (Plan 022, ADR 0033).
 *
 * Mirrors `GET /v1/admin/ci/overview` (server `api/routes/ci.ts`) and the
 * `fix_attempts.ci_infra` verdict (server `_shared/ci-infra.ts`). Keep the
 * shapes identical to the server; the console never reshapes them.
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

export type CiPermission = 'ok' | 'missing' | 'unknown'
export type CiRunnerKind = 'self_hosted' | 'github_hosted' | 'unknown'
export type CiPlatform = 'linux' | 'wsl2' | 'macos' | 'windows'

export interface CiHostRunner {
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

export interface CiRunner {
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

export interface CiRepo {
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
  /** Runner labels the job asked for (`runs-on`). Absent on an older server. */
  labels?: string[]
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
}

export interface CiStats {
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
  /** When the server last live-synced GitHub for this scope; null when it has not. */
  refreshedAt?: string | null
  window: { days: number; from: string }
  permissions: { jobs: CiPermission; runners: CiPermission }
  hosts: CiHost[]
  runners: CiRunner[]
  repos: CiRepo[]
  /** Every queued and in-progress job first, then the newest finished ones (≤ 200). */
  jobs: CiJob[]
  stats: CiStats
  advice: CiAdvice[]
}

/** `POST /v1/admin/fixes/:id/ci/rerun` success body. */
export interface CiRerunResult {
  ok: true
  runId: number
}
