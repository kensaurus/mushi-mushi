/**
 * FILE: ci-compare.test.ts
 * PURPOSE: `_shared/ci-compare.ts` (Plan 022 Phase 7, ADR 0037):
 *            - aggregateCiJobs (the TypeScript mirror of the SQL function):
 *              per-job minute rounding, PR-only pass rate, infra rate,
 *              re-runs, tiny jobs, the window, one-job runners folded, runner
 *              kinds healed from the runner group, intervals merged;
 *            - speed factors need ≥ 5 passed runs on BOTH sides and show the
 *              sample size; zero samples assume 1.0 and say so;
 *            - buildCiCompare: public repos cost $0, private repos pay only
 *              past the owner's included minutes (shared across repos),
 *              larger runners are unpriced, self-hosted machines are grouped
 *              (settings, heartbeat machine id) and parallel jobs are not
 *              double-counted, what-ifs respect pinned jobs and the
 *              main / Dependabot guards, and the "why" facts add up.
 */

import { describe, expect, it } from 'vitest'
import {
  aggregateCiJobs,
  buildCiCompare,
  classOfJob,
  combinedSpeedFactor,
  readComparisonData,
  resolveMachine,
  speedFactors,
  type CompareInput,
  type CompareJobRow,
  type ComparisonPair,
} from '../../supabase/functions/_shared/ci-compare.ts'
import { normalizeCostSettings } from '../../supabase/functions/_shared/ci-cost.ts'

const NOW = new Date('2026-10-22T12:00:00Z')
const ORG = '0000000a-0000-4000-8000-000000000000'
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'

let seq = 0
/** A finished job `minAgo` minutes before NOW that ran `seconds`. */
function job(over: Partial<CompareJobRow> & { minAgo?: number; seconds?: number } = {}): CompareJobRow {
  const { minAgo = 60, seconds = 120, ...rest } = over
  const start = NOW.getTime() - minAgo * 60_000
  seq++
  return {
    project_id: P1,
    repo: 'kensaurus/tsumagoi',
    workflow_name: 'CI',
    job_name: 'Build',
    event: 'pull_request',
    head_branch: `feat/x${seq}`,
    pr_number: 1,
    run_attempt: 1,
    status: 'completed',
    ci_kind: 'passed',
    runner_name: 'GitHub Actions 1000',
    runner_group_name: 'GitHub Actions',
    runner_kind: 'github_hosted',
    runner_labels: ['ubuntu-latest'],
    queue_seconds: 3,
    duration_seconds: seconds,
    started_at: new Date(start).toISOString(),
    completed_at: new Date(start + seconds * 1000).toISOString(),
    gh_created_at: new Date(start - 3000).toISOString(),
    ...rest,
  }
}

const selfJob = (over: Partial<CompareJobRow> & { minAgo?: number; seconds?: number } = {}) =>
  job({ runner_name: 'aw-tsumagoi-1022003316-163', runner_group_name: 'Default', runner_kind: 'unknown', runner_labels: ['kensaurus-local'], ...over })

describe('aggregateCiJobs', () => {
  it('heals stored unknown kinds from the runner group and folds one-job runners to their base', () => {
    const data = aggregateCiJobs([selfJob(), selfJob({ runner_name: 'aw-tsumagoi-1022009999-a1' }), job()])
    const self = data.groups.find((g) => g.runner_class === 'self_hosted')!
    expect(self.runner_base).toBe('aw-tsumagoi')
    expect(self.jobs).toBe(2)
    expect(data.groups.find((g) => g.runner_class === 'github_hosted')!.runner_base).toBeNull()
    expect(classOfJob({ runner_kind: 'unknown', runner_labels: ['kensaurus-local'], runner_name: null, runner_group_name: null })).toBe('unknown')
  })

  it('bills each job in whole minutes (at least 1) and keeps the raw seconds measured', () => {
    const data = aggregateCiJobs([job({ seconds: 7 }), job({ seconds: 61 }), job({ seconds: 600 })])
    const g = data.groups[0]
    expect(g.billed_minutes).toBe(1 + 2 + 10)
    expect(g.raw_seconds).toBe(668)
    expect(g.tiny_jobs).toBe(1)
    expect(g.tiny_raw_seconds).toBe(7)
  })

  it('counts pass rate on pull-request jobs only, and infra over finished jobs', () => {
    const data = aggregateCiJobs([
      job({ ci_kind: 'passed' }),
      job({ ci_kind: 'code_failure' }),
      job({ ci_kind: 'passed', event: 'push', pr_number: null, head_branch: 'main' }),
      job({ ci_kind: 'code_failure', event: 'push', pr_number: null, head_branch: 'main' }),
      job({ ci_kind: 'runner_lost' }),
      job({ ci_kind: 'cancelled' }),
      job({ ci_kind: 'skipped', duration_seconds: null, started_at: null }),
    ])
    const g = data.groups[0]
    expect(g.pr_counted).toBe(3) // passed, code_failure, runner_lost; cancelled and push jobs left out
    expect(g.pr_passed).toBe(1)
    expect(g.finished).toBe(6) // skipped left out
    expect(g.infra).toBe(1)
  })

  it('counts re-runs and their minutes, expired jobs, and nothing for jobs that never ran', () => {
    const data = aggregateCiJobs([
      job({ run_attempt: 2, seconds: 90 }),
      job({ ci_kind: 'queue_expired', status: 'completed', started_at: null, duration_seconds: null, runner_name: null, runner_group_name: null }),
      job({ status: 'queued', ci_kind: 'queued', started_at: null, completed_at: null, duration_seconds: null, queue_seconds: 50 }),
    ])
    const g = data.groups[0]
    expect(g.rerun_jobs).toBe(1)
    expect(g.rerun_billed_minutes).toBe(2)
    expect(g.expired).toBe(1)
    expect(g.billed_minutes).toBe(2)
    // Queue time only counts once a runner took the job.
    expect(g.queue_p95).toBe(3)
  })

  it('drops jobs outside the window and returns empty data for no jobs', () => {
    const from = new Date(NOW.getTime() - 2 * 60 * 60_000)
    const data = aggregateCiJobs([job({ minAgo: 30 }), job({ minAgo: 600 })], { from, to: NOW })
    expect(data.jobs).toBe(1)
    expect(aggregateCiJobs([])).toEqual({ groups: [], pairs: [], workflows: [], intervals: [], oldest: null, jobs: 0 })
  })

  it('merges a runner base\'s job intervals and keeps main / Dependabot minutes apart', () => {
    const data = aggregateCiJobs([
      selfJob({ minAgo: 60, seconds: 600 }),
      selfJob({ minAgo: 55, seconds: 600 }), // overlaps the first
      job({ head_branch: 'main', seconds: 120 }),
      job({ head_branch: 'dependabot/npm/x', seconds: 60 }),
    ])
    expect(data.intervals).toHaveLength(1)
    expect(Date.parse(data.intervals[0].end) - Date.parse(data.intervals[0].start)).toBe(15 * 60_000)
    const wf = data.workflows.find((w) => w.runner_class === 'github_hosted')!
    expect(wf).toMatchObject({ billed_minutes: 3, main_billed_minutes: 2, dependabot_billed_minutes: 1 })
  })
})

describe('speed factors', () => {
  const pair = (cls: 'github_hosted' | 'self_hosted', passed: number, p50: number, jobName = 'Build'): ComparisonPair => ({
    project_id: P1, repo: 'kensaurus/tsumagoi', workflow_name: 'CI', job_name: jobName, runner_class: cls, passed, run_p50: p50,
  })

  it('measures only with ≥ 5 passed runs on each side, and always shows the sample sizes', () => {
    expect(speedFactors([pair('github_hosted', 10, 2268), pair('self_hosted', 10, 1258)])[0]).toMatchObject({ factor: 0.55, hostedSamples: 10, selfHostedSamples: 10 })
    // The plan's "Live pricing parity": 4 / 2 samples — not measured.
    expect(speedFactors([pair('github_hosted', 4, 287), pair('self_hosted', 2, 86)])[0]).toMatchObject({ factor: null, hostedSamples: 4, selfHostedSamples: 2 })
  })

  it('needs both sides: a job seen on one class only has no row', () => {
    expect(speedFactors([pair('github_hosted', 50, 100)])).toEqual([])
    expect(speedFactors([])).toEqual([])
  })

  it('combines per-job factors by their median; with nothing measured it assumes 1.0 and says so', () => {
    const speed = speedFactors([
      pair('github_hosted', 5, 100, 'a'), pair('self_hosted', 5, 50, 'a'),
      pair('github_hosted', 5, 100, 'b'), pair('self_hosted', 5, 100, 'b'),
      pair('github_hosted', 5, 100, 'c'), pair('self_hosted', 5, 300, 'c'),
    ])
    expect(combinedSpeedFactor(speed)).toMatchObject({ factor: 1, measured: true, samplesHosted: 15, samplesSelf: 15 })
    expect(combinedSpeedFactor([])).toMatchObject({ factor: 1, measured: false, samplesHosted: 0, samplesSelf: 0 })
  })
})

describe('readComparisonData', () => {
  it('reads the SQL jsonb, numbers as strings included, and refuses other shapes', () => {
    const d = readComparisonData({ groups: [{ project_id: P1, repo: 'a/b', runner_class: 'self_hosted', os: 'linux', jobs: '4', queue_p95: '12', labels: ['x', 3] }], pairs: null, intervals: [{ runner_base: 'r', start: 'a', end: 'b' }, { runner_base: '' }], oldest: null, jobs: 4 })
    expect(d?.groups[0]).toMatchObject({ jobs: 4, queue_p95: 12, labels: ['x'], runner_class: 'self_hosted', billed_minutes: 0 })
    expect(d?.pairs).toEqual([])
    expect(d?.intervals).toHaveLength(1)
    expect(readComparisonData(null)).toBeNull()
    expect(readComparisonData([])).toBeNull()
    expect(readComparisonData({ groups: 'no' })).toBeNull()
  })
})

const TSUMAGOI_CI = `name: CI
on: [pull_request, push]
jobs:
  build:
    name: Build
    runs-on: \${{ (github.actor != 'dependabot[bot]' && github.ref != 'refs/heads/main' && vars.LINUX_RUNNER) || 'ubuntu-latest' }}
    steps: []
  perf:
    name: Mobile perf gate
    runs-on: ubuntu-latest # TBT budgets failed every PR on the shared machine
    steps: []
`

function input(jobs: CompareJobRow[], over: Partial<CompareInput> = {}): CompareInput {
  const from = new Date(NOW.getTime() - 30 * 24 * 60 * 60_000)
  const settings = normalizeCostSettings(ORG, { organization_id: ORG, plan: 'free', watts_idle: 30, watts_load: 180, price_per_kwh: 0.2, machines: [{ name: 'Alienware', runners: ['aw-', 'alienware-'] }] })
  return {
    now: NOW,
    days: 30,
    from,
    to: NOW,
    data: aggregateCiJobs(jobs, { from, to: NOW }),
    source: 'rows',
    sourceNote: null,
    projects: [{ id: P1, name: 'tsumagoi', organization_id: ORG }, { id: P2, name: 'mushi', organization_id: ORG }],
    repoBindings: [{ project_id: P1, repo: 'kensaurus/tsumagoi' }],
    repoMeta: { 'kensaurus/tsumagoi': { visibility: 'private', owner: 'kensaurus' }, 'kensaurus/mushi-mushi': { visibility: 'public', owner: 'kensaurus' }, 'kensaurus/glot.it': { visibility: 'private', owner: 'kensaurus' } },
    settingsByOrg: new Map([[ORG, settings]]),
    defaultSettings: normalizeCostSettings(ORG, null),
    settingsWritable: true,
    hosts: [],
    runners: [],
    workflows: [{ projectId: P1, repo: 'kensaurus/tsumagoi', path: '.github/workflows/ci.yml', text: TSUMAGOI_CI }],
    variableNames: { 'kensaurus/tsumagoi': ['LINUX_RUNNER'] },
    ...over,
  }
}

/** n hosted jobs of `seconds` each, spread over the last 8 days. */
const hostedMany = (n: number, seconds: number, over: Partial<CompareJobRow> = {}) =>
  Array.from({ length: n }, (_, i) => job({ minAgo: 60 + i * 37, seconds, ...over }))

describe('buildCiCompare', () => {
  it('costs a public repo $0 on GitHub-hosted runners', () => {
    const out = buildCiCompare(input(hostedMany(10, 600, { repo: 'kensaurus/mushi-mushi', project_id: P2 })))
    const row = out.rows.find((r) => r.repo === 'kensaurus/mushi-mushi')!
    expect(row).toMatchObject({ costBasis: 'github_public_free', monthCost: 0, billedMinutes: 100 })
    expect(out.accounts[0]).toMatchObject({ owner: 'kensaurus', monthListCost: 0, monthCost: 0, publicRepos: 1 })
  })

  it('bills a private repo nothing inside the included minutes, and the rest past them, shared across the owner\'s repos', () => {
    // 30 days of data: no projection. 1,500 minutes on tsumagoi + 1,500 on glot = 3,000; Free includes 2,000.
    const jobs = [
      ...Array.from({ length: 150 }, (_, i) => job({ minAgo: 60 + i * 287, seconds: 600 })),
      ...Array.from({ length: 150 }, (_, i) => job({ minAgo: 61 + i * 287, seconds: 600, repo: 'kensaurus/glot.it' })),
    ]
    const out = buildCiCompare(input(jobs))
    const acct = out.accounts.find((a) => a.owner === 'kensaurus')!
    expect(out.dataDays).toBeGreaterThan(29.5)
    expect(acct.monthMinutes).toBeGreaterThan(2900)
    // About 1,000 minutes past the allowance at $0.006 ≈ $6, split evenly.
    expect(acct.monthCost).toBeGreaterThan(5)
    expect(acct.monthCost).toBeLessThan(7)
    expect(acct.includedLeft).toBe(0)
    const t = out.rows.find((r) => r.repo === 'kensaurus/tsumagoi')!
    const g = out.rows.find((r) => r.repo === 'kensaurus/glot.it')!
    expect(Math.abs(t.monthCost - g.monthCost)).toBeLessThan(0.05)
    expect(t.monthCost + g.monthCost).toBeCloseTo(acct.monthCost, 1)

    const small = buildCiCompare(input(hostedMany(20, 120)))
    expect(small.rows[0].monthCost).toBe(0)
    expect(small.accounts[0].includedLeft).toBeGreaterThan(0)
  })

  it('marks larger GitHub runners unpriced instead of guessing', () => {
    const out = buildCiCompare(input(hostedMany(3, 60, { runner_labels: ['linux-x64-16core'] })))
    expect(out.rows[0]).toMatchObject({ runnerClass: 'github_hosted', costBasis: 'github_larger_unpriced', monthCost: 0 })
  })

  it('groups two runners into one machine from your settings and counts parallel jobs once', () => {
    const jobs = [
      selfJob({ minAgo: 120, seconds: 3600 }),
      selfJob({ minAgo: 120, seconds: 3600, runner_name: 'alienware-glot-1', repo: 'kensaurus/glot.it' }), // in parallel
    ]
    const out = buildCiCompare(input(jobs))
    expect(out.machines).toHaveLength(1)
    const m = out.machines[0]
    expect(m).toMatchObject({ name: 'Alienware', source: 'settings', runners: ['alienware-glot-1', 'aw-tsumagoi'], repos: ['kensaurus/glot.it', 'kensaurus/tsumagoi'] })
    expect(m.busyHours).toBe(1)
    // Two job-hours on the clock, one busy hour of electricity; split evenly by job time.
    const rows = out.rows.filter((r) => r.runnerClass === 'self_hosted')
    expect(rows.map((r) => r.machine)).toEqual(['Alienware', 'Alienware'])
    expect(rows[0].monthCost).toBeCloseTo(rows[1].monthCost, 6)
    expect(out.lowConfidence).toBe(true)
  })

  it('groups heartbeat hosts that report the same machine id (two WSL distros on one PC)', () => {
    const hosts = [
      { host_id: 'a'.repeat(64), hostname: 'alienwarex16', metrics: { machine_id: 'f'.repeat(64) }, runners: [{ name: 'glot-runner' }] },
      { host_id: 'b'.repeat(64), hostname: 'alienware-ci', metrics: { machine_id: 'f'.repeat(64) }, runners: [{ name: 'tsu-runner' }] },
      { host_id: 'c'.repeat(64), hostname: 'nuc', metrics: {}, runners: [{ name: 'nuc-runner' }] },
    ]
    const s = normalizeCostSettings(ORG, null)
    expect(resolveMachine('glot-runner', s, hosts)).toMatchObject({ name: 'alienware-ci + alienwarex16', source: 'heartbeat' })
    expect(resolveMachine('tsu-runner-1700000000', s, hosts)).toMatchObject({ name: 'alienware-ci + alienwarex16' })
    expect(resolveMachine('nuc-runner', s, hosts)).toMatchObject({ name: 'nuc', source: 'heartbeat' })
    expect(resolveMachine('lonely', s, hosts)).toMatchObject({ name: 'lonely', source: 'runner' })
  })

  it('what-if: moves only the jobs that follow the variable, keeps main runs and pinned jobs, and shows the measured speed', () => {
    const jobs = [
      // Build: 10 passed on each side, GitHub 2,268 s → Alienware 1,258 s (the plan's 0.55×).
      ...Array.from({ length: 10 }, (_, i) => job({ minAgo: 100 + i * 60, seconds: 2268 })),
      ...Array.from({ length: 10 }, (_, i) => selfJob({ minAgo: 130 + i * 60, seconds: 1258 })),
      job({ minAgo: 900, seconds: 600, head_branch: 'main', event: 'push', pr_number: null }),
      ...Array.from({ length: 5 }, (_, i) => job({ minAgo: 1000 + i * 30, seconds: 300, job_name: 'Mobile perf gate' })),
    ]
    const out = buildCiCompare(input(jobs, { variableNames: { 'kensaurus/tsumagoi': ['LINUX_RUNNER'] } }))
    const w = out.whatIfs.find((x) => x.id.startsWith('to_self:') && x.workflow === 'CI')!
    expect(w.from.runnerClass).toBe('github_hosted')
    expect(w.to).toMatchObject({ runnerClass: 'self_hosted', machine: 'Alienware', label: 'kensaurus-local' })
    // The passed main-branch run is a GitHub-hosted sample too (11), and does not move the median.
    expect(w.speed).toMatchObject({ factor: 0.55, measured: true, samplesFrom: 11, samplesTo: 10 })
    expect(w.stays.map((s) => s.job)).toEqual(expect.arrayContaining(['Build (main)', 'Mobile perf gate']))
    expect(w.stays.find((s) => s.job === 'Mobile perf gate')!.reason).toContain('TBT budgets failed')
    expect(w.monthCostAfter).toBeGreaterThanOrEqual(0)
    expect(w.targetBusyShareAfter!).toBeGreaterThan(w.targetBusyShare!)
    // Pinned job cost and the main-branch guard show up in the explanation.
    expect(out.explain.pinned[0]).toMatchObject({ job: 'Mobile perf gate', label: 'ubuntu-latest', reason: 'TBT budgets failed every PR on the shared machine' })
    expect(out.explain.alwaysHosted[0]).toMatchObject({ job: 'Build', why: 'main_and_dependabot' })
  })

  it('what-if warns when the target machine has no online runner or would be over 70 % busy, and when speed is not measured', () => {
    const jobs = [
      ...Array.from({ length: 3 }, (_, i) => job({ minAgo: 100 + i * 60, seconds: 600 })),
      // A machine busy almost the whole data span.
      selfJob({ minAgo: 60 * 24 * 2, seconds: 60 * 60 * 46 }),
    ]
    const out = buildCiCompare(input(jobs, { runners: [{ repo: 'kensaurus/tsumagoi', runner_name: 'aw-tsumagoi', status: 'offline', labels: ['kensaurus-local'] }] }))
    const w = out.whatIfs.find((x) => x.id.startsWith('to_self:'))!
    expect(w.warnings.join(' ')).toMatch(/No runner on Alienware is online/)
    expect(w.warnings.join(' ')).toMatch(/busy \d+% of the time/)
    expect(w.warnings.join(' ')).toMatch(/Speed not measured/)
    expect(w.speed).toMatchObject({ factor: 1, measured: false })
  })

  it('what-if: a public repo leaving your machine costs nothing on GitHub', () => {
    const jobs = Array.from({ length: 4 }, (_, i) => selfJob({ minAgo: 100 + i * 60, seconds: 900, repo: 'kensaurus/mushi-mushi', project_id: P2 }))
    const out = buildCiCompare(input(jobs))
    const w = out.whatIfs.find((x) => x.id.startsWith('to_hosted:'))!
    expect(w).toMatchObject({ repo: 'kensaurus/mushi-mushi', monthCostAfter: 0 })
    expect(w.monthCostDelta).toBeLessThanOrEqual(0)
  })

  it('explains re-runs, tiny jobs, expired jobs, the macOS ratio and the platform fee', () => {
    const jobs = [
      ...Array.from({ length: 12 }, (_, i) => job({ minAgo: 100 + i, seconds: 7, job_name: 'Gate' })),
      job({ run_attempt: 2, seconds: 120 }),
      selfJob({ run_attempt: 3, seconds: 60 }),
      job({ ci_kind: 'queue_expired', started_at: null, duration_seconds: null, runner_name: null, runner_group_name: null, runner_labels: ['kensaurus-local'], runner_kind: 'unknown' }),
    ]
    const out = buildCiCompare(input(jobs))
    expect(out.explain.tinyJobs).toMatchObject({ jobs: 12, billedMinutes: 12, rawMinutes: 1.4 })
    expect(out.explain.reruns).toMatchObject({ hostedJobs: 1, hostedBilledMinutes: 2, selfHostedJobs: 1 })
    expect(out.explain.queueExpired.jobs).toBe(1)
    expect(out.explain.macosToLinux).toBe(10.3)
    expect(out.explain.platformFeeWhatIf.perMinuteUsd).toBe(0.002)
    expect(out.explain.platformFeeWhatIf.monthCost).toBeGreaterThan(0)
    expect(out.explain.hostedSpecs).toEqual({ privateVcpu: 2, privateRamGb: 8, publicVcpu: 4, publicRamGb: 16 })
  })

  it('labels every field measured or estimated, and says when data is thin', () => {
    const out = buildCiCompare(input([job()]))
    expect(out.fields.queueP95s).toBe('measured')
    expect(out.fields.monthCost).toBe('estimated')
    expect(out.fields.billedMinutes).toBe('estimated')
    expect(out.lowConfidence).toBe(true)
    expect(out.rates).toMatchObject({ fetchedAt: '2026-10-22', usdPerMinute: { linux: 0.006, windows: 0.01, macos: 0.062 } })
  })

  it('returns an empty comparison, not an error, when there are no jobs', () => {
    const out = buildCiCompare(input([]))
    expect(out.rows).toEqual([])
    expect(out.machines).toEqual([])
    expect(out.whatIfs).toEqual([])
    expect(out.dataDays).toBe(0)
    expect(out.repos.map((r) => r.repo)).toEqual(['kensaurus/tsumagoi'])
  })
})

describe('healRunnerKinds (overview read)', () => {
  it('heals jobs stored as unknown from their runner group, and runners from their jobs', async () => {
    const { healRunnerKinds } = await import('../../supabase/functions/_shared/ci-overview.ts')
    const jobs = [
      { repo: 'a/b', runner_name: 'aw-1', runner_kind: 'unknown', runner_group_name: 'Default', runner_labels: ['kensaurus-local'] },
      { repo: 'a/b', runner_name: null, runner_kind: 'unknown', runner_group_name: null, runner_labels: ['kensaurus-local'] },
      { repo: 'a/b', runner_name: 'GitHub Actions 3', runner_kind: 'github_hosted', runner_group_name: 'GitHub Actions', runner_labels: ['ubuntu-latest'] },
    ] as never[]
    const runners = [{ repo: 'a/b', runner_name: 'aw-1', kind: 'unknown' }, { repo: 'a/b', runner_name: 'nuc', kind: 'unknown' }] as never[]
    healRunnerKinds(jobs, runners)
    expect((jobs as Array<{ runner_kind: string }>).map((j) => j.runner_kind)).toEqual(['self_hosted', 'unknown', 'github_hosted'])
    expect((runners as Array<{ kind: string }>).map((r) => r.kind)).toEqual(['self_hosted', 'unknown'])
  })
})
