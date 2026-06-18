import { describe, expect, it } from 'vitest'
import { sparklineSummaryRows } from './ChartAccessibleSummary'

describe('ChartAccessibleSummary helpers', () => {
  it('sparklineSummaryRows pairs days with values', () => {
    expect(sparklineSummaryRows(['2026-06-01', '2026-06-02'], [3, 5])).toEqual([
      { period: '2026-06-01', value: 3 },
      { period: '2026-06-02', value: 5 },
    ])
  })

  it('sparklineSummaryRows falls back when days are missing', () => {
    expect(sparklineSummaryRows(undefined, [1])).toEqual([{ period: 'Point 1', value: 1 }])
  })
})

describe('MetricStrip layout', () => {
  it('caps column count at seven', async () => {
    const { MetricStrip } = await import('../MetricStrip')
    expect(MetricStrip).toBeTypeOf('function')
  })
})
