import { describe, expect, it } from 'vitest'
import { creditCountdowns, expiryLabel, firecrawlPace, paceLine, type CountdownCursorKey } from './creditPlan'

const NOW = new Date('2026-10-23T02:00:00Z')

describe('expiryLabel', () => {
  it('rounds days up, says expired once past, and is null without a usable date', () => {
    expect(expiryLabel('2026-10-28T23:59:59Z', NOW)).toBe('expires Oct 28 (6 days)')
    expect(expiryLabel('2026-10-23T05:00:00Z', NOW)).toBe('expires Oct 23 (1 day)')
    expect(expiryLabel('not a date', NOW)).toBeNull()
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
    expect(firecrawlPace({ remaining: null, periodEnd: null, watches, now: NOW }).perDay).toBe(200 + 60)
  })
  it('projects to the reset and says what would go unused', () => {
    const pace = firecrawlPace({ remaining: 64175, periodEnd: '2026-11-03T00:25:32Z', watches, now: NOW })
    expect(pace).toEqual({ perDay: 260, days: 11, projected: 2860, unused: 61315 })
    expect(paceLine(pace, '2026-11-03T00:25:32Z')).toBe(
      'Watches, audits and rank checks use about 260 a day · about 2,860 before Nov 3 · about 61,315 would go unused.',
    )
  })
  it('says when nothing is watched, or when the balance runs out first', () => {
    expect(paceLine(firecrawlPace({ remaining: 100, periodEnd: null, watches: [], now: NOW }), null)).toBe(
      'Nothing is watched, audited or rank-checked, so nothing is spent.',
    )
    const tight = firecrawlPace({ remaining: 100, periodEnd: '2026-11-03T00:25:32Z', watches, now: NOW })
    expect(paceLine(tight, '2026-11-03T00:25:32Z')).toContain('the balance runs out first')
  })
})

describe('audits and rank checks in the pace', () => {
  const perDay = (audits: Parameters<typeof firecrawlPace>[0]['audits'], rankKeywords = 0) =>
    firecrawlPace({ remaining: null, periodEnd: null, watches: [], audits, rankKeywords, now: NOW }).perDay
  it('spreads a run (pages + the map call) over its cadence, using the last run when known', () => {
    expect(perDay([{ enabled: true, page_limit: 139, cadence_days: 7 }])).toBe(20)
    expect(perDay([{ enabled: true, page_limit: 200, cadence_days: 7, last_summary: { credits: 69 } }])).toBe(10)
    expect(perDay([{ enabled: false, page_limit: 200, cadence_days: 1 }])).toBe(0)
    expect(perDay([], 7)).toBe(4)
    const pace = firecrawlPace({ remaining: 1000, periodEnd: '2026-11-03T00:25:32Z', watches: [], audits: [{ enabled: true, page_limit: 139, cadence_days: 7 }], now: NOW })
    expect(pace.perDay).toBe(20)
  })
})

describe('creditCountdowns', () => {
  const key = (over: Partial<CountdownCursorKey> = {}): CountdownCursorKey => ({
    id: 'k1',
    label: 'hirose',
    keyHint: 'crsr_e76…c203',
    enabled: true,
    creditsExpireAt: '2026-10-28T23:59:59Z',
    dailyLimit: 30,
    dispatchedToday: 4,
    state: 'active',
    scoreboard: { days: 7, totals: { runs: 52 } },
    ...over,
  })
  const firecrawl = { remaining: 64175, limit: 100000, periodEnd: '2026-11-03T00:25:32Z' }

  it('puts the soonest date first and counts Cursor fixes, never a Cursor balance', () => {
    const cards = creditCountdowns({ cursorKeys: [key()], firecrawl, now: NOW })
    expect(cards.map((c) => [c.provider, c.daysLeft])).toEqual([['cursor', 6], ['firecrawl', 11]])
    expect(cards[0].usedLine).toBe('4 of 30 fixes sent today · 52 in the last 7 days')
    expect(cards[0].leftLine).toBe('Room for up to 176 more fixes before they expire.')
    expect(cards[0].usedLine).not.toMatch(/credit|\$/)
    expect(cards[1].usedLine).toBe('35,825 of 100,000 credits used')
    expect(cards[1].leftLine).toBe('64,175 credits left until the reset.')
  })

  it('marks a key with spend-down off as idle, red in its last 3 days', () => {
    expect(creditCountdowns({ cursorKeys: [key({ enabled: false, state: 'off' })], firecrawl: null, now: NOW })[0]).toMatchObject({
      idle: true,
      tone: 'warn',
      leftLine: 'Spend-down is off, so nothing is spending these credits.',
    })
    const soon = creditCountdowns({ cursorKeys: [key({ enabled: false, state: 'off', creditsExpireAt: '2026-10-25T00:00:00Z' })], firecrawl: null, now: NOW })
    expect(soon[0].tone).toBe('danger')
  })

  it('skips keys with no expiry date and an expired key is not idle', () => {
    expect(creditCountdowns({ cursorKeys: [key({ creditsExpireAt: null })], firecrawl: null, now: NOW })).toEqual([])
    const expired = creditCountdowns({ cursorKeys: [key({ enabled: false, creditsExpireAt: '2026-10-01T00:00:00Z' })], firecrawl: null, now: NOW })[0]
    expect(expired).toMatchObject({ daysLeft: 0, idle: false, tone: 'neutral', leftLine: 'These credits have expired.' })
  })
})
