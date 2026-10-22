/**
 * FILE: packages/server/supabase/functions/_shared/ci-compare-types.ts
 * PURPOSE: The response of GET /v1/admin/ci/compare (Plan 022 Phase 7,
 *          ADR 0037): cost and speed per repo × runner class, why it costs
 *          what it costs, and "what if" moves. Read by the console's /ci
 *          "Cost and speed" section, MCP `get_ci_costs` and
 *          `mushi runner compare`; they copy these types, change them here
 *          first.
 *
 * Every number is either MEASURED (from job times GitHub reported) or
 * ESTIMATED (a price, a rounding rule, your electricity figures, a
 * projection); `fields` says which, and every surface labels it.
 *
 * Types only: no runtime code.
 */

import type { CiOverviewAdvice } from './ci-overview-types.ts'

export type CiRunnerClass = 'github_hosted' | 'self_hosted' | 'unknown'
export type CiRunnerOs = 'linux' | 'windows' | 'macos'
export type RepoVisibility = 'public' | 'private' | 'unknown'
export type Provenance = 'measured' | 'estimated'

/** One repo × runner class × OS × runner (self-hosted runners folded to their base name). */
export interface CiCompareRow {
  key: string
  projectId: string
  repo: string
  runnerClass: CiRunnerClass
  os: CiRunnerOs
  /** The runs-on labels seen, e.g. ["ubuntu-latest"] or ["kensaurus-local"]. */
  labels: string[]
  /** Self-hosted: the runner's base name (one-job runners folded); null on GitHub-hosted. */
  runner: string | null
  /** Self-hosted: the physical machine it runs on (your settings, a heartbeat, or the runner itself). */
  machine: string | null
  jobs: number
  /** Jobs that never got a runner and expired. */
  expired: number
  queueP50s: number | null
  queueP95s: number | null
  runP50s: number | null
  runP95s: number | null
  /** Pass rate of pull-request jobs only (main-branch runs would skew it); null with none. */
  prPassRate: number | null
  prJobs: number
  /** Share of finished jobs stopped by the machine (runner lost, queue expired). */
  infraRate: number | null
  /** Σ job run time, minutes. */
  rawMinutes: number
  /** Σ per-job whole minutes (GitHub rounds every job up, at least 1). */
  billedMinutes: number
  /** Jobs on a re-run attempt (run_attempt > 1): GitHub bills them again. */
  rerunJobs: number
  /** Jobs shorter than 20 s that still bill a full minute each. */
  tinyJobs: number
  /** Projected cost for 30 days in `currency`, after included minutes. */
  monthCost: number
  /** How the cost is reached. */
  costBasis: 'github_list' | 'github_public_free' | 'github_larger_unpriced' | 'self_hosted' | 'unknown'
  currency: string
}

export interface CiCompareAccount {
  /** The GitHub account the repos belong to: included minutes are per account. */
  owner: string
  plan: string
  includedMinutes: number
  /** Linux-equivalent GitHub-hosted minutes on private repos, projected to 30 days. */
  monthMinutes: number
  /** List price of those minutes before included minutes, 30 days. */
  monthListCost: number
  /** After included minutes, 30 days. */
  monthCost: number
  /** Included minutes left after the projection (0 when used up). */
  includedLeft: number
  privateRepos: number
  publicRepos: number
  currency: string
}

export interface CiCompareMachine {
  name: string
  /** settings = you grouped it; heartbeat = hosts reporting the same machine id; runner = one runner, its own machine. */
  source: 'settings' | 'heartbeat' | 'runner'
  runners: string[]
  repos: string[]
  /** Union of its job intervals: parallel jobs count once. Measured. */
  busyHours: number
  /** busyHours ÷ the hours in the data span. */
  busyShare: number
  wattsIdle: number
  wattsLoad: number
  monthEnergyCost: number
  monthWearCost: number
  /** GitHub's self-hosted platform fee (default 0: postponed). */
  monthPlatformFee: number
  queueP95s: number | null
  online: boolean | null
  currency: string
}

export interface CiCompareSpeed {
  repo: string
  workflow: string
  job: string
  hostedP50s: number | null
  selfHostedP50s: number | null
  hostedSamples: number
  selfHostedSamples: number
  /** self-hosted ÷ GitHub-hosted run time; null under 5 passed samples on either side. */
  factor: number | null
}

export interface CiCompareWhatIf {
  id: string
  projectId: string
  repo: string
  workflow: string
  from: { runnerClass: CiRunnerClass; label: string; machine: string | null }
  to: { runnerClass: CiRunnerClass; label: string; machine: string | null }
  /** Billed minutes of the jobs that would move, projected to 30 days. */
  monthMinutesMoved: number
  /** Jobs that stay where they are, with why. */
  stays: Array<{ job: string; reason: string }>
  speed: { factor: number; measured: boolean; samplesFrom: number; samplesTo: number }
  monthCostNow: number
  monthCostAfter: number
  monthCostDelta: number
  targetQueueP95s: number | null
  targetBusyShare: number | null
  targetBusyShareAfter: number | null
  warnings: string[]
  currency: string
}

export interface CiCompareExplain {
  /** Re-runs bill again on GitHub; $0 on self-hosted. */
  reruns: { hostedJobs: number; hostedBilledMinutes: number; selfHostedJobs: number }
  /** Jobs under 20 s on paid runners: each still bills a whole minute. */
  tinyJobs: { jobs: number; billedMinutes: number; rawMinutes: number }
  queueExpired: { jobs: number }
  /** macOS ÷ Linux price per minute. */
  macosToLinux: number
  /** What this month would cost if GitHub starts its $0.002/min self-hosted fee. */
  platformFeeWhatIf: { perMinuteUsd: number; monthCost: number }
  pinned: Array<{ repo: string; workflow: string; job: string; label: string; reason: string | null; monthCost: number }>
  alwaysHosted: Array<{ repo: string; workflow: string; job: string; why: 'main' | 'dependabot' | 'main_and_dependabot' }>
  /** Private ubuntu-latest has 2 vCPU / 8 GB; public repos get 4 / 16. */
  hostedSpecs: { privateVcpu: number; privateRamGb: number; publicVcpu: number; publicRamGb: number }
}

export interface CiCompareSettings {
  organizationId: string
  /** 'yours' once saved; 'default' shows the example figures. */
  source: 'default' | 'yours'
  currency: string
  /** Units of `currency` per US dollar (1 for USD). */
  fxPerUsd: number
  wattsIdle: number
  wattsLoad: number
  pricePerKwh: number
  wearPerHour: number
  plan: 'free' | 'pro' | 'team' | 'enterprise' | 'custom'
  includedMinutes: number
  selfHostedFeePerMinuteUsd: number
  machines: Array<{ name: string; runners: string[]; wattsIdle?: number | null; wattsLoad?: number | null }>
  updatedAt: string | null
}

export interface CiCompare {
  generatedAt: string
  window: { days: number; from: string; to: string }
  /** Days of job data actually in the window (the collector keeps 30). */
  dataDays: number
  /** Under 7 days of data: every figure is low confidence. */
  lowConfidence: boolean
  /** 'sql' = ci_runner_comparison over the whole window; 'rows' = the newest jobs only (database update not applied yet). */
  source: 'sql' | 'rows'
  sourceNote: string | null
  rates: { source: string; fetchedAt: string; usdPerMinute: Record<CiRunnerOs, number> }
  fields: Record<string, Provenance>
  settings: CiCompareSettings[]
  /** False until the ci_cost_settings table exists: Settings → CI cost cannot save yet. */
  settingsWritable: boolean
  repos: Array<{ projectId: string; projectName: string; repo: string; visibility: RepoVisibility; owner: string | null }>
  rows: CiCompareRow[]
  accounts: CiCompareAccount[]
  machines: CiCompareMachine[]
  speed: CiCompareSpeed[]
  whatIfs: CiCompareWhatIf[]
  explain: CiCompareExplain
  advice: CiOverviewAdvice[]
}
