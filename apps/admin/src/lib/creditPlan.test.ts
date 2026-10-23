import { describe, expect, it } from 'vitest'
import { auditCreditsPerDay, daysLeft, expiryLabel, firecrawlPace, paceLine, watchCreditsPerDay } from './creditPlan'

const NOW = new Date('2026-10-23T02:00:00Z')

describe('daysLeft / expiryLabel', () => {
  it('rounds up, floors at 0 and is null without a date', () => {
    expect(daysLeft('2026-10-28T23:59:59Z', NOW)).toBe(6)
    expect(daysLeft('2026-10-01T00:00:00Z', NOW)).toBe(0)
    expect(daysLeft(null, NOW)).toBeNull()
    expect(daysLeft('not a date', NOW)).toBeNull()
  })
  it('reads as a short phrase', () => {
    expect(expiryLabel('2026-10-28T23:59:59Z', NOW)).toBe('expires Oct 28 (6 days)')
    expect(expiryLabel('2026-11-03T00:25:32Z', NOW, 'resets')).toBe('resets Nov 3 (11 days)')
    expect(expiryLabel('2026-10-01T00:00:00Z', NOW)).toBe('expired')
    expect(expiryLabel(null, NOW)).toBeNull()
  })
})

describe('firecrawlPace', () => {
  const watches = [
    { status: 'active', page_limit: 100, estimated_credits_per_month: 6000 },
    { status: 'active', page_limit: 30, estimated_credits_per_month: null },
    { status: 'paused', page_limit: 100, estimated_credits_per_month: 6000 },
  ]
  it('sums active watches, using 2 credits a page a day without an estimate', () => {
    expect(watchCreditsPerDay(watches)).toBe(200 + 60)
  })
  it('projects to the reset and says what would go unused', () => {
    const pace = firecrawlPace({ remaining: 64175, periodEnd: '2026-11-03T00:25:32Z', watches, now: NOW })
    expect(pace).toEqual({ perDay: 260, days: 11, projected: 2860, unused: 61315 })
    expect(paceLine(pace, '2026-11-03T00:25:32Z')).toBe(
      'Watches and audits use about 260 a day · about 2,860 before Nov 3 · about 61,315 would go unused.',
    )
  })
  it('says when nothing is watched, or when the balance runs out first', () => {
    expect(paceLine(firecrawlPace({ remaining: 100, periodEnd: null, watches: [], now: NOW }), null)).toBe(
      'No site is watched or audited, so nothing is spent.',
    )
    const tight = firecrawlPace({ remaining: 100, periodEnd: '2026-11-03T00:25:32Z', watches, now: NOW })
    expect(paceLine(tight, '2026-11-03T00:25:32Z')).toContain('the balance runs out first')
  })
})

describe('auditCreditsPerDay', () => {
  it('spreads a run (pages + the map call) over its cadence, using the last run when known', () => {
    expect(auditCreditsPerDay([{ enabled: true, page_limit: 139, cadence_days: 7 }])).toBe(20)
    expect(auditCreditsPerDay([{ enabled: true, page_limit: 200, cadence_days: 7, last_summary: { credits: 69 } }])).toBe(10)
    expect(auditCreditsPerDay([{ enabled: false, page_limit: 200, cadence_days: 1 }])).toBe(0)
    const pace = firecrawlPace({ remaining: 1000, periodEnd: '2026-11-03T00:25:32Z', watches: [], audits: [{ enabled: true, page_limit: 139, cadence_days: 7 }], now: NOW })
    expect(pace.perDay).toBe(20)
  })
})
