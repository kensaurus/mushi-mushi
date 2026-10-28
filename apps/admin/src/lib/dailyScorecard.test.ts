import { describe, expect, it } from 'vitest'
import { rate, scorecardTotals, sortedSources, type ScorecardSource } from './dailyScorecard'

describe('daily scorecard helpers', () => {
  it('totals page views, signups and activated over the window', () => {
    expect(
      scorecardTotals([
        { day: '2026-10-27', page_views: 120, signups: 3, activated: 0 },
        { day: '2026-10-28', page_views: 80, signups: 1, activated: 1 },
      ]),
    ).toEqual({ page_views: 200, signups: 4, activated: 1 })
    expect(scorecardTotals([])).toEqual({ page_views: 0, signups: 0, activated: 0 })
  })

  it('shows a rate only when the base is not zero', () => {
    expect(rate(3, 200)).toBe('1.5%')
    expect(rate(1, 3)).toBe('33%')
    expect(rate(0, 0)).toBe('—')
  })

  it('lists sources by page views, then signups, with unknown last', () => {
    const rows: ScorecardSource[] = [
      { src: 'unknown', page_views: 500, signups: 2, activated: 0 },
      { src: 'reddit', page_views: 40, signups: 2, activated: 1 },
      { src: 'hn', page_views: 300, signups: 1, activated: 0 },
      { src: 'x-thread', page_views: 40, signups: 5, activated: 0 },
    ]
    expect(sortedSources(rows).map((r) => r.src)).toEqual(['hn', 'x-thread', 'reddit', 'unknown'])
  })
})
