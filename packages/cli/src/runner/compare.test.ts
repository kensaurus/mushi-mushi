/**
 * renderCompare: the terminal view of GET /v1/admin/ci/compare. Money always
 * reads as estimated, public repos read "free", larger runners "unpriced",
 * thin speed data says so, and an empty or partial payload still renders.
 */
import { describe, expect, it } from 'vitest'
import { renderCompare } from './compare.js'

describe('renderCompare', () => {
  it('renders accounts, rows, machines, speed, what-ifs and advice', () => {
    const text = renderCompare({
      window: { days: 30 },
      dataDays: 30,
      rates: { fetchedAt: '2026-10-22', usdPerMinute: { linux: 0.006, windows: 0.01, macos: 0.062 } },
      repos: [{ repo: 'kensaurus/mushi-mushi', visibility: 'public' }, { repo: 'kensaurus/tsumagoi', visibility: 'private' }],
      accounts: [{ owner: 'kensaurus', plan: 'free', includedMinutes: 2000, monthMinutes: 23352, monthListCost: 140.11, monthCost: 128.11, currency: 'USD' }],
      rows: [
        { repo: 'kensaurus/mushi-mushi', runnerClass: 'github_hosted', labels: ['ubuntu-latest'], jobs: 172, billedMinutes: 181, monthCost: 0, costBasis: 'github_public_free' },
        { repo: 'kensaurus/tsumagoi', runnerClass: 'self_hosted', labels: ['kensaurus-local'], runner: 'aw-tsumagoi', machine: 'Alienware', jobs: 119, queueP95s: 2909, runP50s: 46, prPassRate: 0.65, billedMinutes: 487, monthCost: 0.31, costBasis: 'self_hosted' },
        { repo: 'kensaurus/glot.it', runnerClass: 'unknown', labels: ['kensaurus-local'], jobs: 239, expired: 202, billedMinutes: 0, monthCost: 0, costBasis: 'unknown' },
        { repo: 'kensaurus/x', runnerClass: 'github_hosted', labels: ['linux-16core'], jobs: 1, costBasis: 'github_larger_unpriced' },
      ],
      machines: [{ name: 'Alienware', busyHours: 14.2, busyShare: 0.12, monthEnergyCost: 0.45, monthWearCost: 0, queueP95s: 2909, online: true }],
      speed: [
        { repo: 'kensaurus/tsumagoi', workflow: 'CI', job: 'Build + browser gates', hostedP50s: 2268, selfHostedP50s: 1258, hostedSamples: 10, selfHostedSamples: 10, factor: 0.55 },
        { repo: 'kensaurus/tsumagoi', workflow: 'CI', job: 'Live pricing parity', hostedSamples: 4, selfHostedSamples: 2, factor: null },
      ],
      whatIfs: [{ repo: 'kensaurus/tsumagoi', workflow: 'CI', to: { machine: 'Alienware' }, monthMinutesMoved: 2051, monthCostDelta: -12.3, speed: { factor: 0.55, measured: true, samplesFrom: 10, samplesTo: 10 }, stays: [{ job: 'Mobile perf gate', reason: 'Pinned to GitHub: TBT budgets' }], warnings: ['Alienware would be busy 80% of the time: jobs will queue.'] }],
      advice: [{ severity: 'high', title: 'kensaurus/yen-yen has no LINUX_RUNNER variable', evidence: 'vars.LINUX_RUNNER is read in ci.yml', fix: 'Create it.' }],
    }).join('\n')
    expect(text).toContain('kensaurus  free plan, 2,000 included')
    expect(text).toContain('after included $128.11 (estimated)')
    expect(text).toMatch(/kensaurus\/mushi-mushi \(public\).*free/)
    expect(text).toMatch(/Self-hosted aw-tsumagoi on Alienware/)
    expect(text).toMatch(/Never picked up \(kensaurus-local\)/)
    expect(text).toContain('unpriced')
    expect(text).toContain('Alienware: busy 14.2 h (12%)')
    expect(text).toContain('38 min → 21 min = 0.55× (10/10 runs)')
    expect(text).toContain('1 more job ran on both but with too few passed runs to measure.')
    expect(text).toContain('Move kensaurus/tsumagoi · CI to Alienware: −$12.30 a month, 2,051 min moved, 0.55× measured (10/10 runs)')
    expect(text).toContain('stays: Mobile perf gate — Pinned to GitHub: TBT budgets')
    expect(text).toContain('! Alienware would be busy 80%')
    expect(text).toContain('HIGH    kensaurus/yen-yen has no LINUX_RUNNER variable')
    expect(text).toContain('money are estimated')
  })

  it('renders an empty payload without throwing', () => {
    const text = renderCompare({}).join('\n')
    expect(text).toContain('No CI jobs in this window.')
  })

  it('formats money in another currency, minutes and hours, and labels without a runner or labels', () => {
    const text = renderCompare({
      rows: [
        { repo: 'a/b', runnerClass: 'self_hosted', labels: ['self-hosted', 'x'], runner: null, jobs: 1, queueP95s: 600, runP50s: 7200, monthCost: 1.5, costBasis: 'self_hosted', currency: 'JPY' },
        { repo: 'a/c', runnerClass: 'github_hosted', labels: [], os: 'macos', jobs: 1, queueP95s: 45, monthCost: null as unknown as number, costBasis: 'github_list' },
      ],
    }).join('\n')
    expect(text).toMatch(/Self-hosted x\s/)
    expect(text).toContain('GitHub-hosted (macos)')
    expect(text).toContain('1.50 JPY')
    expect(text).toMatch(/10 min\s+2 h/)
    expect(text).toContain('45 s')
    expect(text).toMatch(/—\s*$/m)
  })
})
