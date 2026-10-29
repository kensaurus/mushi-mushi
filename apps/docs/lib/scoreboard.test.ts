import { describe, expect, it, vi } from 'vitest'
import { formatAsOf, formatCount, formatHours, loadScoreboard, sparklinePath, sparklinePoints } from './scoreboard'

describe('formatHours', () => {
  it('reads as people say it', () => {
    expect(formatHours(26.4)).toBe('26 hours')
    expect(formatHours(0.5)).toBe('30 minutes')
    expect(formatHours(100)).toBe('4.2 days')
    expect(formatHours(null)).toBe('not enough data yet')
  })
})

describe('formatCount', () => {
  it('groups thousands, and shows a dash for a number the API did not send', () => {
    expect(formatCount(1068)).toBe('1,068')
    expect(formatCount(undefined)).toBe('–')
    expect(formatCount(Number.NaN)).toBe('–')
  })
})

describe('formatAsOf', () => {
  it('dates the numbers in UTC', () => {
    expect(formatAsOf('2026-10-28T12:05:00.000Z')).toBe('Oct 28, 2026, 12:05 UTC')
  })
})

describe('sparkline', () => {
  it('puts the tallest week at the top and zero weeks on the baseline', () => {
    const pts = sparklinePoints([0, 7, 1, 0, 147, 77], 100, 40)
    expect(pts[0]).toEqual({ x: 0, y: 40 })
    expect(pts[4]).toEqual({ x: 80, y: 0 })
    expect(pts[5].x).toBe(100)
    expect(sparklinePath(pts.slice(0, 2))).toBe('M0 40 L20 38.1')
  })

  it('all zeros stay flat, one value draws one point', () => {
    expect(sparklinePoints([0, 0], 10, 5).map((p) => p.y)).toEqual([5, 5])
    expect(sparklinePoints([3], 10, 5)).toEqual([{ x: 0, y: 0 }])
    expect(sparklinePoints([], 10, 5)).toEqual([])
  })
})

describe('loadScoreboard', () => {
  it('null when the API is down, so the page says so instead of showing zeros', async () => {
    expect(await loadScoreboard((async () => new Response('', { status: 503 })) as unknown as typeof fetch)).toBeNull()
    expect(
      await loadScoreboard(vi.fn(async () => {
        throw new TypeError('offline')
      }) as unknown as typeof fetch),
    ).toBeNull()
  })
})
