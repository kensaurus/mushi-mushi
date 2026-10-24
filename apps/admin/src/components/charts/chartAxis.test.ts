/**
 * Axis copy on the dashboard (2026-10-04 audit): the calls chart printed
 * "-0.0" on its bottom tick, and narrow KPI tiles ran four date labels
 * together ("Sep 2SSep 25Today").
 *
 * Count charts (2026-10-24): linear 12% headroom produced fractional ticks
 * (12.3/24.6/37.0); nice integer steps keep REPORTS / FIXES labels whole.
 */
import { describe, expect, it } from 'vitest'
import { buildYTickValues, formatChartCount, sparseXLabels } from './chartAxis'

describe('buildYTickValues / formatChartCount', () => {
  it('ends exactly on the floor, so the bottom label is "0"', () => {
    for (const peak of [6, 23, 25.8, 0.3, 387_000]) {
      const ticks = buildYTickValues(peak, 0, 4)
      expect(ticks[ticks.length - 1]).toBe(0)
      expect(formatChartCount(ticks[ticks.length - 1])).toBe('0')
    }
  })

  it('never prints a negative zero', () => {
    expect(formatChartCount(-1e-15)).toBe('0')
    expect(formatChartCount(-0.04)).toBe('0')
  })

  it('uses integer nice steps for count peaks (no 12.3-style fractions)', () => {
    expect(buildYTickValues(33, 0, 4, 0.12, { integer: true })).toEqual([
      40, 30, 20, 10, 0,
    ])
    expect(buildYTickValues(57, 0, 4, 0.12, { integer: true })).toEqual([
      60, 40, 20, 0,
    ])
    for (const peak of [33, 57]) {
      const ticks = buildYTickValues(peak, 0, 4, 0.12, { integer: true })
      for (const t of ticks) {
        expect(Number.isInteger(t)).toBe(true)
        expect(formatChartCount(t)).not.toMatch(/\.\d/)
      }
    }
  })
})

describe('sparseXLabels', () => {
  const days = Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 10).padStart(2, '0')}`)

  it('keeps first and last only when capped at 2', () => {
    expect(sparseXLabels(days, 2).map((t) => t.index)).toEqual([0, 13])
  })

  it('still spreads 4 ticks on wide charts', () => {
    expect(sparseXLabels(days)).toHaveLength(4)
  })
})
