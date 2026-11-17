import { describe, expect, it } from 'vitest'
import { jobSpread, spreadScaleMax } from './CiJobTimes'

describe('job times spread', () => {
  const t = (p50: number | null, p90: number | null, max: number | null) => ({ durationP50s: p50, durationP90s: p90, durationMaxS: max })

  it('scales every row to the longest run of any job, shown or not', () => {
    expect(spreadScaleMax([t(60, 120, 300), t(600, 900, 1200), t(null, null, null)])).toBe(1200)
    expect(jobSpread(t(300, 600, 900), 1200)).toEqual({ usualPct: 25, slowPct: 50, longestPct: 75 })
  })

  it('keeps usual ≤ slow ≤ longest when a percentile is missing or out of order', () => {
    expect(jobSpread(t(300, null, null), 600)).toEqual({ usualPct: 50, slowPct: 50, longestPct: 50 })
    expect(jobSpread(t(300, 200, 100), 600)).toEqual({ usualPct: 50, slowPct: 50, longestPct: 50 })
  })

  it('draws nothing for a job with no finished run', () => {
    expect(jobSpread(t(null, null, null), 600)).toBeNull()
    expect(jobSpread(t(60, 60, 60), 0)).toBeNull()
  })
})
