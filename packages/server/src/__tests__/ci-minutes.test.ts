/**
 * `_shared/ci-minutes.ts` — estimated GitHub Actions minutes (Plan 019 §1.5):
 * ceil per job, at least 1 per completed job, runner multipliers, unfinished
 * jobs count 0, and a spike needs a real baseline.
 */
import { describe, expect, it } from 'vitest'
import {
  billedMinutesOf,
  describeMinutes,
  estimateRunMinutes,
  GITHUB_RUNNER_RATES,
  isMinutesSpike,
  ranSelfHosted,
  RUNNER_PRICE_RATIO,
  runnerOsOf,
  usdPerMinuteFor,
} from '../../supabase/functions/_shared/ci-minutes.ts'

const job = (start: string, end: string | null, labels: string[] = ['ubuntu-latest']) => ({ started_at: start, completed_at: end, labels })

describe('estimateRunMinutes', () => {
  it('rounds each job up, bills at least a minute, and prices each OS from the dated rate table', () => {
    const est = estimateRunMinutes([
      job('2026-10-01T00:00:00Z', '2026-10-01T00:03:10Z'), // 4 linux
      job('2026-10-01T00:00:00Z', '2026-10-01T00:00:05Z'), // 1 linux (minimum)
      job('2026-10-01T00:00:00Z', '2026-10-01T00:02:00Z', ['windows-latest']), // 2 windows
      job('2026-10-01T00:00:00Z', '2026-10-01T00:12:30Z', ['macos-15']), // 13 macos
    ])
    expect(est.breakdown).toEqual({ linux: 5, windows: 2, macos: 13 })
    // 5 × 0.006 + 2 × 0.010 + 13 × 0.062 = 0.856 USD
    expect(est.listUsd).toBeCloseTo(0.856, 6)
    // Linux-equivalent minutes: 0.856 / 0.006
    expect(est.minutes).toBeCloseTo(142.67, 2)
    expect(est.selfHostedMinutes).toBe(0)
    expect(est.estimated).toBe(true)
  })

  it('counts unfinished or unreadable jobs as zero', () => {
    expect(estimateRunMinutes([job('2026-10-01T00:00:00Z', null), { started_at: null, completed_at: null }, job('nope', 'nope')]).minutes).toBe(0)
  })

  it('never bills a self-hosted job, whether it has the self-hosted label or only a runner group', () => {
    const est = estimateRunMinutes([
      job('2026-10-01T00:00:00Z', '2026-10-01T00:10:00Z', ['self-hosted', 'linux']),
      { ...job('2026-10-01T00:00:00Z', '2026-10-01T00:00:30Z', ['kensaurus-local']), runner_group_name: 'Default' },
      { ...job('2026-10-01T00:00:00Z', '2026-10-01T00:01:01Z'), runner_group_name: 'GitHub Actions' },
    ])
    expect(est.selfHostedMinutes).toBe(11)
    expect(est.breakdown.linux).toBe(2)
    expect(est.listUsd).toBeCloseTo(0.012, 6)
  })

  it('prices arm64 and ubuntu-slim at their own rates', () => {
    expect(usdPerMinuteFor({ labels: ['ubuntu-24.04-arm'] })).toBe(GITHUB_RUNNER_RATES.usdPerMinuteLinuxArm)
    expect(usdPerMinuteFor({ labels: ['ubuntu-slim'] })).toBe(GITHUB_RUNNER_RATES.usdPerMinuteLinuxSlim)
    expect(usdPerMinuteFor({ labels: ['macos-14'] })).toBe(0.062)
  })
})

describe('rate table', () => {
  it('is dated and sourced, with the 2026 ratios instead of 1 / 2 / 10', () => {
    expect(GITHUB_RUNNER_RATES.fetchedAt).toBe('2026-10-22')
    expect(GITHUB_RUNNER_RATES.source).toBe('https://docs.github.com/en/billing/reference/actions-runner-pricing')
    expect(GITHUB_RUNNER_RATES.usdPerMinute).toEqual({ linux: 0.006, windows: 0.01, macos: 0.062 })
    expect(RUNNER_PRICE_RATIO.windows).toBeCloseTo(1.667, 3)
    expect(RUNNER_PRICE_RATIO.macos).toBeCloseTo(10.333, 3)
  })

  it('bills every job at least one whole minute', () => {
    expect(billedMinutesOf(0)).toBe(1)
    expect(billedMinutesOf(7)).toBe(1)
    expect(billedMinutesOf(60)).toBe(1)
    expect(billedMinutesOf(61)).toBe(2)
    expect(billedMinutesOf(null)).toBe(0)
    expect(billedMinutesOf(-5)).toBe(0)
  })

  it('tells self-hosted from hosted the same way the collector does', () => {
    expect(ranSelfHosted({ labels: ['kensaurus-local'], runner_group_name: 'Default' })).toBe(true)
    expect(ranSelfHosted({ labels: ['ubuntu-latest'], runner_group_name: 'GitHub Actions' })).toBe(false)
    expect(ranSelfHosted({ labels: ['x'], runner_name: 'GitHub Actions 4', runner_group_name: 'Default' })).toBe(false)
    expect(ranSelfHosted({ labels: ['ubuntu-latest'] })).toBe(false)
  })

  it('leaves a custom-label job with no runner group out of the price, as the collector calls it unknown', () => {
    const est = estimateRunMinutes([{ ...job('2026-10-01T00:00:00Z', '2026-10-01T00:02:00Z', ['kensaurus-local']) }])
    expect(est).toMatchObject({ unknownMinutes: 2, selfHostedMinutes: 0, listUsd: 0, minutes: 0 })
    expect(ranSelfHosted({ labels: ['kensaurus-local'] })).toBe(false)
  })
})

describe('isMinutesSpike', () => {
  it('flags more than twice the 4-week median', () => {
    expect(isMinutesSpike(250, [100, 120, 90, 110])).toBe(true)
    expect(isMinutesSpike(200, [100, 120, 90, 110])).toBe(false)
    // Only the newest four weeks count.
    expect(isMinutesSpike(250, [1000, 1000, 100, 120, 90, 110])).toBe(true)
  })

  it('has no opinion without a baseline', () => {
    expect(isMinutesSpike(500, [100])).toBe(false)
    expect(isMinutesSpike(500, [0, 0, 0])).toBe(false)
  })
})
