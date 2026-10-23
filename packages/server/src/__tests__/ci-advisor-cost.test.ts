/**
 * FILE: ci-advisor-cost.test.ts
 * PURPOSE: The cost rules of `_shared/ci-advisor.ts` (adviseCiCost, Plan 022
 *          Phase 7). Each rule fires on its evidence and stays silent
 *          without its data:
 *            paid_while_idle, public_on_busy_self_hosted,
 *            missing_runner_variable (yen-yen on 2026-10-22: workflows read
 *            vars.LINUX_RUNNER, the repo had no such variable),
 *            pinned_hosted_cost, tiny_job_rounding, self_hosted_on_public_repo.
 */

import { describe, expect, it } from 'vitest'
import { adviseCiCost, type CostAdvisorInput } from '../../supabase/functions/_shared/ci-advisor.ts'
import { parseRepoWorkflows } from '../../supabase/functions/_shared/ci-runs-on.ts'
import type { CiCompareMachine, CiCompareRow } from '../../supabase/functions/_shared/ci-compare-types.ts'

const P1 = '1000000a-0000-4000-8000-000000000000'

function row(over: Partial<CiCompareRow>): CiCompareRow {
  return {
    key: Math.random().toString(36),
    projectId: P1,
    repo: 'kensaurus/yen-yen',
    runnerClass: 'github_hosted',
    os: 'linux',
    labels: ['ubuntu-24.04'],
    runner: null,
    machine: null,
    jobs: 40,
    expired: 0,
    queueP50s: 2,
    queueP95s: 4,
    runP50s: 120,
    runP95s: 400,
    prPassRate: 0.9,
    prJobs: 30,
    infraRate: 0,
    rawMinutes: 300,
    billedMinutes: 330,
    rerunJobs: 0,
    tinyJobs: 0,
    monthCost: 12.5,
    costBasis: 'github_list',
    currency: 'USD',
    ...over,
  }
}

function machine(over: Partial<CiCompareMachine>): CiCompareMachine {
  return {
    name: 'Alienware',
    source: 'settings',
    runners: ['alienware-yen-yen-1'],
    repos: ['kensaurus/yen-yen'],
    busyHours: 2,
    busyShare: 0.05,
    wattsIdle: 30,
    wattsLoad: 180,
    monthEnergyCost: 0.3,
    monthWearCost: 0,
    monthPlatformFee: 0,
    queueP95s: 30,
    online: true,
    currency: 'USD',
    ...over,
  }
}

const YEN_CI = `name: CI
on: pull_request
jobs:
  lint:
    runs-on: \${{ (github.actor != 'dependabot[bot]' && github.ref != 'refs/heads/main' && vars.LINUX_RUNNER) || 'ubuntu-24.04' }}
    steps: []
  bundle:
    runs-on: \${{ (github.actor != 'dependabot[bot]' && github.ref != 'refs/heads/main' && vars.LINUX_RUNNER) || 'ubuntu-24.04' }}
    steps: []
`

function base(over: Partial<CostAdvisorInput> = {}): CostAdvisorInput {
  return {
    now: new Date('2026-10-22T12:00:00Z'),
    spanDays: 2,
    repos: [{ projectId: P1, repo: 'kensaurus/yen-yen', visibility: 'private' }],
    rows: [],
    machines: [],
    workflows: [],
    variableNames: {},
    parsed: new Map(),
    pinned: [],
    tinyJobs: [],
    ...over,
  }
}

const ids = (input: CostAdvisorInput) => adviseCiCost(input).map((a) => a.id)

describe('paid_while_idle', () => {
  it('fires when a private repo pays for GitHub minutes while its machine is mostly idle', () => {
    const advice = adviseCiCost(base({ rows: [row({})], machines: [machine({})] }))
    const a = advice.find((x) => x.id === 'paid_while_idle:kensaurus/yen-yen')!
    expect(a.severity).toBe('high')
    expect(a.evidence).toMatch(/330 GitHub-hosted minutes in 2 days/)
    expect(a.evidence).toMatch(/\$12\.50 a month/)
    expect(a.evidence).toMatch(/Alienware was busy 5%/)
  })

  it('is medium under $10 a month', () => {
    expect(adviseCiCost(base({ rows: [row({ monthCost: 3 })], machines: [machine({})] }))[0].severity).toBe('medium')
  })

  it('stays silent inside the included minutes, on a busy or offline machine, on a public or unknown repo', () => {
    expect(ids(base({ rows: [row({ monthCost: 0 })], machines: [machine({})] }))).not.toContain('paid_while_idle:kensaurus/yen-yen')
    expect(ids(base({ rows: [row({})], machines: [machine({ busyShare: 0.6 })] }))).toEqual([])
    expect(ids(base({ rows: [row({})], machines: [machine({ online: false })] }))).toEqual([])
    expect(ids(base({ rows: [row({})], machines: [machine({})], repos: [{ projectId: P1, repo: 'kensaurus/yen-yen', visibility: 'unknown' }] }))).toEqual([])
    expect(ids(base({ rows: [row({})], machines: [] }))).toEqual([])
  })
})

describe('public repo on your machine', () => {
  const pub = { repos: [{ projectId: P1, repo: 'kensaurus/mushi-mushi', visibility: 'public' as const }] }
  const selfRow = (over: Partial<CiCompareRow> = {}) =>
    row({ repo: 'kensaurus/mushi-mushi', runnerClass: 'self_hosted', costBasis: 'self_hosted', runner: 'kensaurus-local-mushi-1', machine: 'NUC', monthCost: 0.2, ...over })

  it('public_on_busy_self_hosted fires on a queue p95 over 10 minutes with ≥ 5 jobs', () => {
    const advice = adviseCiCost(base({ ...pub, rows: [selfRow({ queueP95s: 45 * 60 })] }))
    expect(advice.map((a) => a.id)).toEqual(['public_on_busy_self_hosted:kensaurus/mushi-mushi', 'self_hosted_on_public_repo:kensaurus/mushi-mushi'])
    expect(advice[0].evidence).toMatch(/Queue p95 45 min over 40 jobs on NUC/)
  })

  it('a short queue or a handful of jobs only warns about forks', () => {
    expect(ids(base({ ...pub, rows: [selfRow({ queueP95s: 60 })] }))).toEqual(['self_hosted_on_public_repo:kensaurus/mushi-mushi'])
    expect(ids(base({ ...pub, rows: [selfRow({ queueP95s: 99999, jobs: 4 })] }))).toEqual(['self_hosted_on_public_repo:kensaurus/mushi-mushi'])
  })

  it('self_hosted_on_public_repo names the machine and the job count', () => {
    const a = adviseCiCost(base({ ...pub, rows: [selfRow({ jobs: 1, queueP95s: 1 })] }))[0]
    expect(a.evidence).toMatch(/^1 job of this public repo ran on NUC/)
    expect(a.fix).toMatch(/require approval/)
  })

  it('a private repo on your machine gets neither', () => {
    expect(ids(base({ rows: [row({ repo: 'kensaurus/yen-yen', runnerClass: 'self_hosted', queueP95s: 99999 })] }))).toEqual([])
  })
})

describe('missing_runner_variable', () => {
  const parsed = new Map([['kensaurus/yen-yen', parseRepoWorkflows([{ path: '.github/workflows/ci.yml', text: YEN_CI }])]])

  it('fires high on a private repo whose workflows read vars.LINUX_RUNNER when the repo has no such variable', () => {
    const a = adviseCiCost(base({ parsed, variableNames: { 'kensaurus/yen-yen': ['EXPO_PUBLIC_API_URL'] }, machines: [machine({})] }))[0]
    expect(a).toMatchObject({ id: 'missing_runner_variable:kensaurus/yen-yen:LINUX_RUNNER', severity: 'high' })
    expect(a.title).toMatch(/so its jobs run on ubuntu-24.04/)
    expect(a.detail).toMatch(/2 jobs pick their runner from vars.LINUX_RUNNER/)
    expect(a.detail).toMatch(/even though a self-hosted runner has served this repo/)
  })

  it('is silent when the variable exists (any case) or when the variable list could not be read', () => {
    expect(ids(base({ parsed, variableNames: { 'kensaurus/yen-yen': ['linux_runner'] } }))).toEqual([])
    expect(ids(base({ parsed, variableNames: { 'kensaurus/yen-yen': null } }))).toEqual([])
    expect(ids(base({ parsed, variableNames: {} }))).toEqual([])
  })

  it('is low on a public repo (GitHub minutes are free there)', () => {
    const a = adviseCiCost(base({ parsed, variableNames: { 'kensaurus/yen-yen': [] }, repos: [{ projectId: P1, repo: 'kensaurus/yen-yen', visibility: 'public' }] }))[0]
    expect(a.severity).toBe('low')
  })
})

describe('pinned_hosted_cost', () => {
  it('lists pins worth at least 1 a month with their reasons, one advice per repo', () => {
    const a = adviseCiCost(base({
      rows: [row({ repo: 'kensaurus/tsumagoi', monthCost: 0 })],
      pinned: [
        { repo: 'kensaurus/tsumagoi', workflow: 'CI', job: 'Mobile perf gate', label: 'ubuntu-latest', reason: 'TBT budgets failed every PR on the shared machine', monthCost: 12.3 },
        { repo: 'kensaurus/tsumagoi', workflow: 'CI', job: 'Secret scan', label: 'ubuntu-latest', reason: null, monthCost: 1.2 },
        { repo: 'kensaurus/tsumagoi', workflow: 'CI', job: 'Tiny', label: 'ubuntu-latest', reason: 'x', monthCost: 0.4 },
      ],
    }))
    const pin = a.find((x) => x.id === 'pinned_hosted_cost:kensaurus/tsumagoi')!
    expect(pin.title).toMatch(/about \$13\.50 a month/)
    expect(pin.evidence).toMatch(/Mobile perf gate: \$12\.30 \(“TBT budgets failed/)
    expect(pin.evidence).toMatch(/Secret scan: \$1\.20 \(no reason given\)/)
    expect(pin.evidence).not.toMatch(/Tiny/)
  })

  it('is silent with no pins above the floor', () => {
    expect(ids(base({ pinned: [{ repo: 'a/b', workflow: 'w', job: 'j', label: 'ubuntu-latest', reason: null, monthCost: 0.99 }] }))).toEqual([])
  })
})

describe('tiny_job_rounding', () => {
  it('fires on ≥ 10 jobs under 20 s that waste ≥ 10 billed minutes', () => {
    const a = adviseCiCost(base({ tinyJobs: [{ repo: 'kensaurus/glot.it', jobs: 30, rawSeconds: 30 * 7, billedMinutes: 30, allJobs: 80 }] }))[0]
    expect(a.id).toBe('tiny_job_rounding:kensaurus/glot.it')
    expect(a.evidence).toBe('30 jobs under 20 s in 2 days ran 3.5 minutes and billed 30.')
  })

  it('stays silent below either threshold', () => {
    expect(ids(base({ tinyJobs: [{ repo: 'a/b', jobs: 9, rawSeconds: 9, billedMinutes: 9, allJobs: 9 }] }))).toEqual([])
    expect(ids(base({ tinyJobs: [{ repo: 'a/b', jobs: 12, rawSeconds: 12 * 19, billedMinutes: 12, allJobs: 12 }] }))).toEqual([])
  })
})

describe('ordering', () => {
  it('puts high severity first', () => {
    const parsed = new Map([['kensaurus/yen-yen', parseRepoWorkflows([{ path: 'ci.yml', text: YEN_CI }])]])
    const advice = adviseCiCost(base({
      parsed,
      variableNames: { 'kensaurus/yen-yen': [] },
      tinyJobs: [{ repo: 'kensaurus/yen-yen', jobs: 30, rawSeconds: 30, billedMinutes: 30, allJobs: 30 }],
    }))
    expect(advice.map((a) => a.severity)).toEqual(['high', 'low'])
  })
})
