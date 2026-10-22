/**
 * Typed CiOverview fixtures for the /ci tests, shaped like the glot.it NUC
 * day in Plan 022 (an OOM-killed runner, a queue behind it).
 */

import type { CiJob, CiOverview } from '../../../lib/ciTypes'
import type { CiCompare, CiCompareSettings } from '../../../lib/ciCompareTypes'

export const FIXTURE_NOW = Date.parse('2026-10-21T12:00:00Z')

const GLOT = 'kensaurus/glot.it'
const MUSHI = 'kensaurus/mushi-mushi'
const P1 = '11111111-1111-4111-8111-111111111111'

function job(over: Partial<CiJob> & Pick<CiJob, 'id' | 'repo' | 'jobName' | 'status' | 'ciKind' | 'createdAt'>): CiJob {
  return {
    projectId: P1,
    runId: 1000,
    jobId: Number(over.id.replace(/\D/g, '')) || 1,
    workflowName: 'CI',
    headBranch: 'mushi/fix',
    prNumber: null,
    conclusion: null,
    infra: false,
    infraDetail: null,
    runnerName: null,
    runnerKind: 'self_hosted',
    labels: ['self-hosted', 'Linux', 'X64'],
    queueSeconds: null,
    durationSeconds: null,
    startedAt: null,
    completedAt: null,
    htmlUrl: `https://github.com/${over.repo}/actions/runs/1000/job/${over.id}`,
    memPeakMb: null,
    ...over,
  }
}

export const FIXTURE_JOBS: CiJob[] = [
  job({ id: 'j1', repo: GLOT, jobName: 'build', status: 'in_progress', ciKind: 'running', prNumber: 141, runnerName: 'nuc-glot', createdAt: '2026-10-21T11:50:00Z', startedAt: '2026-10-21T11:52:00Z', queueSeconds: 120 }),
  job({ id: 'j2', repo: GLOT, jobName: 'e2e', status: 'queued', ciKind: 'waiting_for_runner', prNumber: 142, labels: ['self-hosted', 'Linux', 'X64', 'nuc'], createdAt: '2026-10-21T11:30:00Z' }),
  job({ id: 'j3', repo: GLOT, jobName: 'build', status: 'queued', ciKind: 'queued', prNumber: 143, labels: ['self-hosted', 'nuc'], createdAt: '2026-10-21T11:55:00Z' }),
  job({ id: 'j4', repo: MUSHI, jobName: 'lint', status: 'queued', ciKind: 'queued', runnerKind: 'github_hosted', labels: ['ubuntu-latest'], createdAt: '2026-10-21T11:58:00Z' }),
  job({ id: 'j5', repo: MUSHI, jobName: 'typecheck', status: 'completed', conclusion: 'success', ciKind: 'passed', runnerName: 'GitHub Actions 2', runnerKind: 'github_hosted', labels: ['ubuntu-latest'], createdAt: '2026-10-21T11:00:00Z', startedAt: '2026-10-21T11:01:00Z', completedAt: '2026-10-21T11:09:00Z', queueSeconds: 60, durationSeconds: 480 }),
  job({ id: 'j6', repo: GLOT, jobName: 'build', status: 'completed', conclusion: 'cancelled', ciKind: 'runner_lost', infra: true, infraDetail: 'The self-hosted runner: nuc-glot lost communication with the server.', prNumber: 140, runnerName: 'nuc-glot', createdAt: '2026-10-21T11:04:00Z', startedAt: '2026-10-21T11:05:00Z', completedAt: '2026-10-21T11:20:00Z', queueSeconds: 60, durationSeconds: 900, memPeakMb: 10100 }),
  job({ id: 'j7', repo: MUSHI, jobName: 'test', status: 'completed', conclusion: 'failure', ciKind: 'code_failure', runnerName: 'aw-1', createdAt: '2026-10-21T10:29:00Z', startedAt: '2026-10-21T10:30:00Z', completedAt: '2026-10-21T10:40:00Z', queueSeconds: 60, durationSeconds: 600 }),
  job({ id: 'j8', repo: GLOT, jobName: 'deploy', status: 'completed', conclusion: 'cancelled', ciKind: 'queue_expired', infra: true, infraDetail: 'No runner picked this job up in 24 h.', createdAt: '2026-10-20T11:00:00Z', completedAt: '2026-10-21T11:00:00Z', queueSeconds: 86400 }),
  job({ id: 'j9', repo: MUSHI, jobName: 'docs', status: 'completed', conclusion: 'cancelled', ciKind: 'cancelled', runnerName: 'aw-1', createdAt: '2026-10-21T09:00:00Z', startedAt: '2026-10-21T09:01:00Z', completedAt: '2026-10-21T09:05:00Z', queueSeconds: 60, durationSeconds: 240 }),
]

export function ciOverviewFixture(over: Partial<CiOverview> = {}): CiOverview {
  return {
    generatedAt: '2026-10-21T11:59:50Z',
    refreshedAt: '2026-10-21T11:59:40Z',
    window: { days: 7, from: '2026-10-14T12:00:00Z' },
    permissions: { jobs: 'ok', runners: 'ok' },
    hosts: [
      {
        hostId: 'h-nuc',
        hostname: 'nuc',
        platform: 'linux',
        cpuCount: 8,
        memTotalMb: 16000,
        lastHeartbeatAt: '2026-10-21T11:58:00Z',
        stale: false,
        mushiVersion: '1.40.0',
        metrics: { load1: 6.2, memUsedMb: 14500, swapUsedMb: 3900, swapTotalMb: 4096, diskFreeGb: 40 },
        runners: [{ name: 'nuc-glot', repo: GLOT, service: 'actions.runner.glot', active: true, restarts: 3, memCurrentMb: 9800, memMaxMb: 10240, oomKills: 1 }],
      },
      {
        hostId: 'h-aw',
        hostname: 'alienware-wsl',
        platform: 'wsl2',
        cpuCount: 16,
        memTotalMb: 32000,
        lastHeartbeatAt: '2026-10-21T09:00:00Z',
        stale: true,
        mushiVersion: null,
        metrics: {},
        runners: [{ name: 'aw-1', repo: MUSHI, service: null, active: false, restarts: 0, memCurrentMb: null, memMaxMb: null, oomKills: 0 }],
      },
    ],
    runners: [
      { projectId: P1, repo: GLOT, name: 'nuc-glot', status: 'online', busy: true, labels: ['self-hosted', 'Linux', 'X64', 'nuc'], kind: 'self_hosted', hostId: 'h-nuc', lastJobAt: '2026-10-21T11:52:00Z', jobs24h: 40, infraFailures7d: 2 },
      { projectId: P1, repo: MUSHI, name: 'aw-1', status: 'offline', busy: false, labels: ['self-hosted', 'Linux'], kind: 'self_hosted', hostId: 'h-aw', lastJobAt: '2026-10-21T10:40:00Z', jobs24h: 5, infraFailures7d: 0 },
      { projectId: P1, repo: MUSHI, name: 'GitHub Actions 2', status: 'unknown', busy: null, labels: ['ubuntu-latest'], kind: 'github_hosted', hostId: null, lastJobAt: '2026-10-21T11:09:00Z', jobs24h: 12, infraFailures7d: 0 },
      { projectId: P1, repo: GLOT, name: 'mystery', status: 'online', busy: false, labels: ['self-hosted'], kind: 'self_hosted', hostId: null, lastJobAt: null, jobs24h: 0, infraFailures7d: 0 },
    ],
    repos: [
      { projectId: P1, projectName: 'glot.it', repo: GLOT, queued: 2, running: 1, jobs7d: 300, passRate: 0.82, queueP95s: 1800, durationP50s: 420 },
      { projectId: P1, projectName: 'glot.it', repo: MUSHI, queued: 1, running: 0, jobs7d: 120, passRate: 0.95, queueP95s: 60, durationP50s: 300 },
    ],
    jobs: FIXTURE_JOBS,
    stats: {
      jobs: 420,
      passRate: 0.86,
      queueP50s: 90,
      queueP95s: 1500,
      durationP50s: 400,
      durationP95s: 1200,
      infraFailures: 6,
      codeFailures: 9,
      byRunner: [{ runner: 'nuc-glot', jobs: 300, busySeconds: 90000, infraFailures: 6, queueP95s: 1800 }],
      byWorkflow: [{ repo: GLOT, workflow: 'CI', jobs: 300, durationP50s: 420, durationP95s: 1300, failRate: 0.18 }],
      slowSteps: [{ repo: GLOT, job: 'build', step: 'pnpm install', p50s: 180, runs: 280 }],
    },
    advice: [
      {
        id: 'oom-kills',
        severity: 'high',
        title: 'nuc-glot ran out of memory',
        detail: 'The runner service hit its memory cap and was killed mid-job.',
        evidence: '1 OOM kill in 7 days; peak 10.1 GB of a 10 GB cap.',
        fix: 'sudo systemctl set-property actions.runner.glot MemoryMax=12G',
        runner: 'nuc-glot',
        hostId: 'h-nuc',
      },
      {
        id: 'cancel-in-progress',
        severity: 'low',
        title: 'Old pushes keep running',
        detail: 'A newer push does not cancel the run for an older one.',
        evidence: 'CI has no concurrency group.',
        fix: 'concurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true',
        repo: GLOT,
      },
    ],
    ...over,
  }
}

export function emptyCiOverview(): CiOverview {
  return ciOverviewFixture({
    hosts: [],
    runners: [],
    repos: [],
    jobs: [],
    advice: [],
    stats: { jobs: 0, passRate: null, queueP50s: null, queueP95s: null, durationP50s: null, durationP95s: null, infraFailures: 0, codeFailures: 0, byRunner: [], byWorkflow: [], slowSteps: [] },
  })
}

/**
 * The tsumagoi day: one-job runners named `aw-tsumagoi-<MMDDhhmmss>-<n>`, one
 * busy, plus an ordinary runner that must stay its own card.
 */
export function oneJobRunnersFixture(): CiOverview {
  const T = 'kensaurus/tsumagoi'
  const base = ciOverviewFixture()
  const jobs: CiJob[] = [
    job({ id: 't1', repo: T, jobName: 'Build + unit tests', workflowName: 'ci-pr.yml', status: 'completed', conclusion: 'success', ciKind: 'passed', runnerName: 'aw-tsumagoi-1021100000-163', createdAt: '2026-10-21T10:00:00Z', startedAt: '2026-10-21T10:01:00Z', completedAt: '2026-10-21T10:20:00Z', durationSeconds: 1140 }),
    job({ id: 't2', repo: T, jobName: 'E2E', workflowName: 'ci-pr.yml', status: 'completed', conclusion: 'failure', ciKind: 'code_failure', runnerName: 'aw-tsumagoi-1021100500-356', createdAt: '2026-10-21T10:05:00Z', startedAt: '2026-10-21T10:06:00Z', completedAt: '2026-10-21T10:30:00Z', durationSeconds: 1440 }),
    job({ id: 't3', repo: T, jobName: 'Lint', workflowName: 'ci-pr.yml', status: 'in_progress', ciKind: 'running', runnerName: 'aw-tsumagoi-1021115500-7', createdAt: '2026-10-21T11:55:00Z', startedAt: '2026-10-21T11:56:00Z' }),
    job({ id: 't4', repo: T, jobName: 'Deploy', workflowName: 'deploy.yml', status: 'completed', conclusion: 'success', ciKind: 'passed', runnerName: 'alienware-glot-1', createdAt: '2026-10-21T09:00:00Z', startedAt: '2026-10-21T09:01:00Z', completedAt: '2026-10-21T09:05:00Z', durationSeconds: 240 }),
  ]
  const P = base.runners[0].projectId
  const row = (name: string, lastJobAt: string, status: 'online' | 'offline', busy: boolean, jobs24h: number) =>
    ({ projectId: P, repo: T, name, status, busy, labels: ['self-hosted', 'tsumagoi'], kind: 'self_hosted' as const, hostId: null, lastJobAt, jobs24h, infraFailures7d: 0 })
  return ciOverviewFixture({
    hosts: [],
    runners: [
      row('aw-tsumagoi-1021100000-163', '2026-10-21T10:01:00Z', 'offline', false, 1),
      row('aw-tsumagoi-1021100500-356', '2026-10-21T10:06:00Z', 'offline', false, 1),
      row('aw-tsumagoi-1021115500-7', '2026-10-21T11:56:00Z', 'online', true, 1),
      row('alienware-glot-1', '2026-10-21T09:01:00Z', 'online', false, 1),
    ],
    repos: [{ projectId: P, projectName: 'tsumagoi', repo: T, queued: 0, running: 1, jobs7d: 4, passRate: 0.67, queueP95s: 60, durationP50s: 600 }],
    jobs,
  })
}

// ── GET /v1/admin/ci/compare (Plan 022 Phase 7, ADR 0037): live-shaped data from 2026-10-22: a private repo
// paying for GitHub minutes with an Alienware runner, a public repo free, jobs never picked up.

export const ORG_ID = '0000000a-0000-4000-8000-000000000000'

export function costSettingsFixture(over: Partial<CiCompareSettings> = {}): CiCompareSettings {
  return {
    organizationId: ORG_ID,
    source: 'default',
    currency: 'USD',
    fxPerUsd: 1,
    wattsIdle: 30,
    wattsLoad: 180,
    pricePerKwh: 0.2,
    wearPerHour: 0,
    plan: 'free',
    includedMinutes: 2000,
    selfHostedFeePerMinuteUsd: 0,
    machines: [],
    updatedAt: null,
    ...over,
  }
}

export function ciCompareFixture(over: Partial<CiCompare> = {}): CiCompare {
  return {
    generatedAt: '2026-10-22T12:00:00Z',
    window: { days: 30, from: '2026-09-22T12:00:00Z', to: '2026-10-22T12:00:00Z' },
    dataDays: 2.3,
    lowConfidence: true,
    source: 'sql',
    sourceNote: null,
    rates: { source: 'https://docs.github.com/en/billing/reference/actions-runner-pricing', fetchedAt: '2026-10-22', usdPerMinute: { linux: 0.006, windows: 0.01, macos: 0.062 } },
    fields: { queueP95s: 'measured', runP50s: 'measured', prPassRate: 'measured', billedMinutes: 'estimated', monthCost: 'estimated' },
    settings: [costSettingsFixture()],
    settingsWritable: true,
    repos: [
      { projectId: 'p1', projectName: 'tsumagoi', repo: 'kensaurus/tsumagoi', visibility: 'private', owner: 'kensaurus' },
      { projectId: 'p2', projectName: 'mushi', repo: 'kensaurus/mushi-mushi', visibility: 'public', owner: 'kensaurus' },
      { projectId: 'p3', projectName: 'glot.it', repo: 'kensaurus/glot.it', visibility: 'unknown', owner: 'kensaurus' },
    ],
    rows: [
      { key: 'a', projectId: 'p1', repo: 'kensaurus/tsumagoi', runnerClass: 'github_hosted', os: 'linux', labels: ['ubuntu-latest'], runner: null, machine: null, jobs: 203, expired: 0, queueP50s: 2, queueP95s: 3, runP50s: 216, runP95s: 1892, prPassRate: 0.914, prJobs: 162, infraRate: 0, rawMinutes: 1295.4, billedMinutes: 1387, rerunJobs: 77, tinyJobs: 29, monthCost: 61.37, costBasis: 'github_list', currency: 'USD' },
      { key: 'b', projectId: 'p1', repo: 'kensaurus/tsumagoi', runnerClass: 'self_hosted', os: 'linux', labels: ['kensaurus-local'], runner: 'aw-tsumagoi', machine: 'Alienware', jobs: 119, expired: 0, queueP50s: 26, queueP95s: 2909, runP50s: 46, runP95s: 1268, prPassRate: 0.646, prJobs: 113, infraRate: 0.026, rawMinutes: 420.1, billedMinutes: 487, rerunJobs: 80, tinyJobs: 34, monthCost: 0.92, costBasis: 'self_hosted', currency: 'USD' },
      { key: 'c', projectId: 'p2', repo: 'kensaurus/mushi-mushi', runnerClass: 'github_hosted', os: 'linux', labels: ['ubuntu-latest'], runner: null, machine: null, jobs: 172, expired: 0, queueP50s: 2, queueP95s: 3, runP50s: 34, runP95s: 304, prPassRate: 0.987, prJobs: 76, infraRate: 0, rawMinutes: 127.1, billedMinutes: 181, rerunJobs: 0, tinyJobs: 8, monthCost: 0, costBasis: 'github_public_free', currency: 'USD' },
      { key: 'd', projectId: 'p3', repo: 'kensaurus/glot.it', runnerClass: 'unknown', os: 'linux', labels: ['kensaurus-local'], runner: null, machine: null, jobs: 239, expired: 202, queueP50s: null, queueP95s: null, runP50s: null, runP95s: null, prPassRate: 0, prJobs: 202, infraRate: 0.96, rawMinutes: 0, billedMinutes: 0, rerunJobs: 0, tinyJobs: 0, monthCost: 0, costBasis: 'unknown', currency: 'USD' },
    ],
    accounts: [{ owner: 'kensaurus', plan: 'free', includedMinutes: 2000, monthMinutes: 23352, monthListCost: 140.11, monthCost: 128.11, includedLeft: 0, privateRepos: 2, publicRepos: 1, currency: 'USD' }],
    machines: [{ name: 'Alienware', source: 'settings', runners: ['aw-tsumagoi'], repos: ['kensaurus/tsumagoi'], busyHours: 14.2, busyShare: 0.26, wattsIdle: 30, wattsLoad: 180, monthEnergyCost: 0.85, monthWearCost: 0, monthPlatformFee: 0, queueP95s: 2909, online: true, currency: 'USD' }],
    speed: [
      { repo: 'kensaurus/tsumagoi', workflow: 'CI', job: 'Build + browser gates', hostedP50s: 2268, selfHostedP50s: 1258, hostedSamples: 10, selfHostedSamples: 10, factor: 0.55 },
      { repo: 'kensaurus/tsumagoi', workflow: 'CI', job: 'Live pricing parity', hostedP50s: 287, selfHostedP50s: 86, hostedSamples: 4, selfHostedSamples: 2, factor: null },
    ],
    whatIfs: [
      {
        id: 'to_self:p1:kensaurus/tsumagoi:CI',
        projectId: 'p1',
        repo: 'kensaurus/tsumagoi',
        workflow: 'CI',
        from: { runnerClass: 'github_hosted', label: 'ubuntu-latest', machine: null },
        to: { runnerClass: 'self_hosted', label: 'kensaurus-local', machine: 'Alienware' },
        monthMinutesMoved: 9200,
        stays: [{ job: 'Mobile perf gate', reason: 'Pinned to GitHub: TBT budgets failed every PR on the shared machine' }],
        speed: { factor: 0.55, measured: true, samplesFrom: 10, samplesTo: 10 },
        monthCostNow: 55.2,
        monthCostAfter: 1.1,
        monthCostDelta: -54.1,
        targetQueueP95s: 2909,
        targetBusyShare: 0.26,
        targetBusyShareAfter: 0.74,
        warnings: ['Alienware would be busy 74% of the time: jobs will queue.'],
        currency: 'USD',
      },
    ],
    explain: {
      reruns: { hostedJobs: 77, hostedBilledMinutes: 300, selfHostedJobs: 80 },
      tinyJobs: { jobs: 29, billedMinutes: 29, rawMinutes: 3.2 },
      queueExpired: { jobs: 202 },
      macosToLinux: 10.3,
      platformFeeWhatIf: { perMinuteUsd: 0.002, monthCost: 6.5 },
      pinned: [{ repo: 'kensaurus/tsumagoi', workflow: 'CI', job: 'Mobile perf gate', label: 'ubuntu-latest', reason: 'TBT budgets failed every PR on the shared machine', monthCost: 12.31 }],
      alwaysHosted: [{ repo: 'kensaurus/tsumagoi', workflow: 'CI', job: 'Build + browser gates', why: 'main_and_dependabot' }],
      hostedSpecs: { privateVcpu: 2, privateRamGb: 8, publicVcpu: 4, publicRamGb: 16 },
    },
    advice: [
      { id: 'missing_runner_variable:kensaurus/yen-yen:LINUX_RUNNER', severity: 'high', title: 'kensaurus/yen-yen has no LINUX_RUNNER variable, so its jobs run on ubuntu-24.04', detail: '2 jobs pick their runner from vars.LINUX_RUNNER.', evidence: 'vars.LINUX_RUNNER is read in .github/workflows/ci.yml.', fix: 'Create the repo variable LINUX_RUNNER.', repo: 'kensaurus/yen-yen' },
    ],
    ...over,
  }
}
