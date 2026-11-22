import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CiHourly } from './ciTypes'
import { buildWeekGrid, divergeClass, failClass, heatClass } from './ciWeek'

// The grid is in the viewer's time zone; pin one so the test means the same everywhere.
const TZ = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'UTC'
})
afterAll(() => {
  process.env.TZ = TZ
})

function hours(fromIso: string, count: number, fill: (i: number) => Partial<CiHourly> = () => ({})): CiHourly[] {
  const start = Date.parse(fromIso)
  return Array.from({ length: count }, (_, i) => ({
    at: new Date(start + i * 3_600_000).toISOString(),
    jobs: 0,
    passed: 0,
    codeFailures: 0,
    infraFailures: 0,
    ...fill(i),
  }))
}

describe('buildWeekGrid', () => {
  const now = Date.parse('2026-11-17T10:30:00Z')

  it('is null without hourly data (an older server)', () => {
    expect(buildWeekGrid(undefined, undefined, now)).toBeNull()
    expect(buildWeekGrid([], undefined, now)).toBeNull()
  })

  it('lays out the last 7 days by local hour, with uncovered and future hours as null', () => {
    const series = hours('2026-11-10T11:00:00Z', 168, (i) => ({ jobs: i % 3 }))
    const grid = buildWeekGrid(series, '2026-11-10T11:00:00Z', now)!
    expect(grid.days).toHaveLength(7)
    expect(grid.days.every((d) => d.hours.length === 24)).toBe(true)
    // Today: hours after 10:00 have not happened yet.
    const today = grid.days.at(-1)!
    expect(today.hours[10]).not.toBeNull()
    expect(today.hours[11]).toBeNull()
    // The first day (Nov 11) is fully inside the window.
    expect(grid.days[0]!.hours.every((h) => h != null)).toBe(true)
    expect(grid.max).toBe(2)
  })

  it('hatches hours before hourlyFrom (a capped read) instead of calling them quiet', () => {
    const series = hours('2026-11-10T11:00:00Z', 168)
    const grid = buildWeekGrid(series, '2026-11-12T06:00:00Z', now)!
    const nov12 = grid.days[1]!
    expect(nov12.hours[5]).toBeNull()
    expect(nov12.hours[6]).toBe(0)
  })

  it('sums each day and computes its pass rate from finished tests only', () => {
    const series = hours('2026-11-16T00:00:00Z', 24, (i) => (i === 9 ? { jobs: 10, passed: 6, codeFailures: 2, infraFailures: 2 } : {}))
    const day = buildWeekGrid(series, undefined, now)!.days.at(-2)!
    expect(day).toMatchObject({
      jobs: 10,
      passed: 6,
      codeFailures: 2,
      infraFailures: 2,
      passRate: 0.75,
    })
  })
})

describe('cell classes', () => {
  it('heat: hatched for no data, grey for zero, six steps up to the max', () => {
    expect(heatClass(null, 10)).toBe('ci-nodata')
    expect(heatClass(0, 10)).toBe('ci-cell-0')
    expect(heatClass(1, 10)).toBe('ci-heat-1')
    expect(heatClass(10, 10)).toBe('ci-heat-6')
  })

  it('diverging: grey on target, red below, blue above, in 5-point steps', () => {
    expect(divergeClass(0.8)).toBe('ci-mid')
    expect(divergeClass(0.79)).toBe('ci-mid')
    expect(divergeClass(0.77)).toBe('ci-divr-1')
    expect(divergeClass(0.6)).toBe('ci-divr-4')
    expect(divergeClass(0.86)).toBe('ci-divb-2')
    expect(divergeClass(null)).toBe('ci-nodata')
  })

  it('fail: grey at zero, five steps up to 40%', () => {
    expect(failClass(0)).toBe('ci-cell-0')
    expect(failClass(0.05)).toBe('ci-fail-1')
    expect(failClass(0.9)).toBe('ci-fail-5')
  })
})
