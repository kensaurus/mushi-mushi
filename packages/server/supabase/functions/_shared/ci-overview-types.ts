/**
 * FILE: packages/server/supabase/functions/_shared/ci-overview-types.ts
 * PURPOSE: The response of GET /v1/admin/ci/overview (Plan 022 Phase 4),
 *          the one CI view behind the console's /ci page, the Portfolio
 *          card, MCP `get_ci_overview` and `mushi runner status`. The
 *          console and the CLI copy these types; change them here first.
 *
 * Types only: no runtime code.
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

export interface CiOverview {
  generatedAt: string
  /**
   * When the newest live sync of the scoped projects ran (`refresh=1`, at
   * most once a minute per project); null when none ever ran. Older data
   * comes from the 10-minute collector and the workflow_job webhook.
   */
  refreshedAt: string | null
  window: { days: number; from: string }
  permissions: { jobs: 'ok' | 'missing' | 'unknown'; runners: 'ok' | 'missing' | 'unknown' }
  hosts: Array<{
    hostId: string
    hostname: string
    platform: 'linux' | 'wsl2' | 'macos' | 'windows'
    cpuCount: number | null
    memTotalMb: number | null
    lastHeartbeatAt: string
    stale: boolean
    mushiVersion: string | null
    metrics: { load1?: number; memUsedMb?: number; swapUsedMb?: number; swapTotalMb?: number; diskFreeGb?: number }
    runners: Array<{
      name: string
      repo: string | null
      service: string | null
      active: boolean
      restarts: number | null
      memCurrentMb: number | null
      memMaxMb: number | null
      oomKills: number | null
    }>
  }>
  runners: Array<{
    projectId: string
    repo: string
    name: string
    status: 'online' | 'offline' | 'unknown'
    busy: boolean | null
    labels: string[]
    kind: 'self_hosted' | 'github_hosted' | 'unknown'
    hostId: string | null
    lastJobAt: string | null
    jobs24h: number
    infraFailures7d: number
  }>
  repos: Array<{
    projectId: string
    projectName: string
    repo: string
    queued: number
    running: number
    jobs7d: number
    passRate: number | null
    queueP95s: number | null
    durationP50s: number | null
  }>
  /**
   * Every queued / in-progress job in scope first (never cut off), then the
   * newest finished jobs, up to 200 in total.
   */
  jobs: Array<{
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
    runnerKind: 'self_hosted' | 'github_hosted' | 'unknown'
    /** The job's runs-on labels: a queued job's say which machine it waits for. */
    labels: string[]
    queueSeconds: number | null
    durationSeconds: number | null
    createdAt: string
    startedAt: string | null
    completedAt: string | null
    htmlUrl: string | null
    memPeakMb: number | null
  }>
  stats: {
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
  advice: Array<{
    id: string
    severity: 'high' | 'medium' | 'low'
    title: string
    detail: string
    evidence: string
    fix: string
    repo?: string | null
    runner?: string | null
    hostId?: string | null
    /** Projected saving per 30 days if the fix is applied (USD, estimated); null when it cannot be priced. */
    monthSavingUsd?: number | null
    /** Mushi can open a PR that applies this fix to one workflow file (POST /v1/admin/ci/cost-fixes). */
    autofix?: CiCostAutofix | null
  }>
}

/** The workflow edits Mushi can open as a reviewed PR (`_shared/ci-cost-fix.ts`). */
export const CI_COST_FIX_KINDS = ['add_concurrency', 'skip_drafts', 'weekly_cron', 'ignore_docs_paths'] as const
export type CiCostFixKind = (typeof CI_COST_FIX_KINDS)[number]

export interface CiCostAutofix {
  kind: CiCostFixKind
  projectId: string
  repo: string
  /** Repo-relative path, e.g. `.github/workflows/ci.yml`. */
  workflowPath: string
}

export type CiOverviewAdvice = CiOverview['advice'][number]
export type CiOverviewJob = CiOverview['jobs'][number]
export type CiOverviewHost = CiOverview['hosts'][number]
export type CiOverviewRunner = CiOverview['runners'][number]
