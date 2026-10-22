/**
 * A GET /v1/admin/ci/compare payload shaped like the live data on
 * 2026-10-22: a private repo paying for GitHub minutes with an Alienware
 * runner, a public repo on GitHub for free, jobs that were never picked up.
 */
import type { CiCompare, CiCompareSettings } from '../../../lib/ciCompareTypes'

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
