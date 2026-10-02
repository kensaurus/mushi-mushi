/**
 * `_shared/ci-minutes.ts` — estimated GitHub Actions minutes (Plan 019 §1.5):
 * ceil per job, at least 1 per completed job, runner multipliers, unfinished
 * jobs count 0, and a spike needs a real baseline.
 */
import { describe, expect, it } from 'vitest'
import { describeMinutes, estimateRunMinutes, isMinutesSpike, runnerOsOf } from '../../supabase/functions/_shared/ci-minutes.ts'

const job = (start: string, end: string | null, labels: string[] = ['ubuntu-latest']) => ({ started_at: start, completed_at: end, labels })

describe('estimateRunMinutes', () => {
  it('rounds each job up, bills at least a minute, and applies the runner multiplier', () => {
    const est = estimateRunMinutes([
      job('2026-10-01T00:00:00Z', '2026-10-01T00:03:10Z'), // 4 linux
      job('2026-10-01T00:00:00Z', '2026-10-01T00:00:05Z'), // 1 linux (minimum)
      job('2026-10-01T00:00:00Z', '2026-10-01T00:02:00Z', ['windows-latest']), // 2 windows → 4
      job('2026-10-01T00:00:00Z', '2026-10-01T00:12:30Z', ['macos-15']), // 13 macos → 130
    ])
    expect(est.breakdown).toEqual({ linux: 5, windows: 2, macos: 13 })
    expect(est.minutes).toBe(5 + 4 + 130)
    expect(est.estimated).toBe(true)
  })

  it('counts unfinished or unreadable jobs as zero', () => {
    expect(estimateRunMinutes([job('2026-10-01T00:00:00Z', null), { started_at: null, completed_at: null }, job('nope', 'nope')]).minutes).toBe(0)
  })

  it('reads the runner OS from labels or the runner name, Linux otherwise', () => {
    expect(runnerOsOf({ labels: ['self-hosted', 'macOS'] })).toBe('macos')
    expect(runnerOsOf({ runner_name: 'GitHub Actions 12' })).toBe('linux')
    expect(runnerOsOf({ labels: ['windows-2022'] })).toBe('windows')
    expect(runnerOsOf({})).toBe('linux')
  })

  it('always says the number is estimated', () => {
    expect(describeMinutes({ minutes: 42 }, 30)).toMatch(/estimated/)
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
