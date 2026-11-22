import { describe, expect, it } from 'vitest'
import { jobSpread, spreadScaleMax } from './CiJobTimes'

describe('job times spread', () => {
  const t = (p50: number | null, p90: number | null, max: number | null) => ({ durationP50s: p50, durationP90s: p90, durationMaxS: max })

  it('scales the rows it is given to their slowest p90, not to one outlier run', () => {
    expect(spreadScaleMax([t(60, 120, 300), t(600, 900, 1200), t(null, null, null)])).toBe(900)
    // 2026-11-18: one 55-minute run squeezed every bar under 30%.
    expect(spreadScaleMax([t(300, 600, 3300), t(240, 480, 500)])).toBe(600)
    expect(jobSpread(t(300, 600, 900), 1200)).toEqual({ usualPct: 25, slowPct: 50, longestPct: 75, clipped: false })
  })

  it('clips a longest run past the scale at the edge and says so', () => {
    expect(jobSpread(t(300, 600, 3300), 600)).toEqual({ usualPct: 50, slowPct: 100, longestPct: 100, clipped: true })
    // Only longest runs known: they set the scale rather than nothing drawing.
    expect(spreadScaleMax([t(null, null, 400)])).toBe(400)
  })

  it('keeps usual ≤ slow ≤ longest when a percentile is missing or out of order', () => {
    expect(jobSpread(t(300, null, null), 600)).toEqual({ usualPct: 50, slowPct: 50, longestPct: 50, clipped: false })
    expect(jobSpread(t(300, 200, 100), 600)).toEqual({ usualPct: 50, slowPct: 50, longestPct: 50, clipped: false })
  })

  it('draws nothing for a job with no finished run', () => {
    expect(jobSpread(t(null, null, null), 600)).toBeNull()
    expect(jobSpread(t(60, 60, 60), 0)).toBeNull()
  })
})
