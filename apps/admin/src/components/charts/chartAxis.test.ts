/**
 * Axis copy on the dashboard (2026-10-04 audit): the calls chart printed
 * "-0.0" on its bottom tick, and narrow KPI tiles ran four date labels
 * together ("Sep 2SSep 25Today").
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
