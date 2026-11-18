/**
 * Journey optimizer helpers (owner, 2026-11-18): the score waits for a scan,
 * and the common paths rank by visits so they read without the flow map.
 */
import { describe, expect, it } from 'vitest'
import { journeyScoreStat, rankedPaths } from './journeys'

describe('journeyScoreStat', () => {
  it('says not scanned yet, never "100 · no problems found", before a scan', () => {
    expect(journeyScoreStat(100, 0, false)).toEqual({ value: '—', detail: 'not scanned yet', tone: 'off' })
  })

  it('shows the score and what to look at once scanned', () => {
    expect(journeyScoreStat(100, 0, true)).toEqual({ value: '100', detail: 'no problems found', tone: 'ok' })
    expect(journeyScoreStat(42, 3, true)).toEqual({ value: '42', detail: '3 to look at', tone: 'danger' })
  })
})

describe('rankedPaths', () => {
  it('ranks most visits first with a share of all visits, capped at the limit', () => {
    const flows = [
      { pages: ['/', '/a'], sessions: 3 },
      { pages: ['/', '/b'], sessions: 9 },
      { pages: ['/', '/c'], sessions: 5 },
    ]
    const ranked = rankedPaths(flows, 20, 2)
    expect(ranked.map((r) => r.sessions)).toEqual([9, 5])
    expect(ranked[0].share).toBeCloseTo(0.45)
    expect(rankedPaths(flows, 0)[0].share).toBeNull()
  })
})
