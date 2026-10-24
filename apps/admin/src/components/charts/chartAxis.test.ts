/**
 * Axis copy on the dashboard (2026-10-04 audit): the calls chart printed
 * "-0.0" on its bottom tick, and narrow KPI tiles ran four date labels
 * together ("Sep 2SSep 25Today").
 *
 * Count charts (2026-10-24): linear 12% headroom produced fractional ticks
 * (12.3/24.6/37.0); nice integer steps keep REPORTS / FIXES labels whole.
 *
 * scaleToData (2026-10-24): true → plot max is the nice tick top; false →
 * base resolveChartMax(values, false). Non-count ticks stay on the master
 * linear path.
 */
import { describe, expect, it } from 'vitest'
import {
  buildYTickValues,
  formatChartCount,
  resolveChartMax,
  resolvePlotChartMax,
  sparseXLabels,
} from './chartAxis'

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

  it('uses integer nice steps for count peak 33; the plot top is the top tick in both modes', () => {
    const values = [33, 10, 5]
    const ticks = buildYTickValues(33, 0, 4, 0.12, { integer: true })
    expect(ticks).toEqual([40, 30, 20, 10, 0])
    for (const t of ticks) {
      expect(Number.isInteger(t)).toBe(true)
      expect(formatChartCount(t)).not.toMatch(/\.\d/)
    }
    expect(resolvePlotChartMax(values, ticks[0], true)).toBe(40)
    // scaleToData false: no headroom, still whole numbers, and the plot top is the top tick.
    const flat = buildYTickValues(33, 0, 4, 0, { integer: true })
    expect(flat[0]).toBeGreaterThanOrEqual(33)
    expect(flat.every((t) => Number.isInteger(t))).toBe(true)
    expect(resolvePlotChartMax(values, flat[0], false)).toBe(flat[0])
  })

  it('uses integer nice steps for count peak 57 (scaleToData true and false)', () => {
    const values = [57, 12, 3]
    const ticks = buildYTickValues(57, 0, 4, 0.12, { integer: true })
    expect(ticks).toEqual([60, 40, 20, 0])
    for (const t of ticks) {
      expect(Number.isInteger(t)).toBe(true)
      expect(formatChartCount(t)).not.toMatch(/\.\d/)
    }
    expect(resolvePlotChartMax(values, ticks[0], true)).toBe(60)
    const flat = buildYTickValues(57, 0, 4, 0, { integer: true })
    expect(flat[0]).toBeGreaterThanOrEqual(57)
    expect(resolvePlotChartMax(values, flat[0], false)).toBe(flat[0])
  })

  it('adds headroom when the count peak is already a nice number', () => {
    const ticks = buildYTickValues(40, 0, 4, 0.12, { integer: true })
    expect(ticks[0]).toBe(50)
    expect(ticks[ticks.length - 1]).toBe(0)
    for (const t of ticks) expect(Number.isInteger(t)).toBe(true)
  })

  it('keeps non-count (USD) ticks on the master linear path', () => {
    // Exact origin/master buildYTickValues(33) — no nice-step.
    expect(buildYTickValues(33, 0, 4)).toEqual([36.96, 24.64, 12.32, 0])
    expect(buildYTickValues(57, 0, 4)).toEqual([63.84, 42.56, 21.28, 0])
    const usdValues = [1.23, 0.4, 0.1]
    expect(resolveChartMax(usdValues, true)).toBeCloseTo(1.23 * 1.12)
    expect(resolveChartMax(usdValues, false)).toBe(1.23)
    // Non-count callers use resolveChartMax, not the count-only plot helper.
    expect(buildYTickValues(1.23, 0, 4)).toEqual([
      1.3776000000000002,
      0.9184000000000001,
      0.45920000000000005,
      0,
    ])
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
