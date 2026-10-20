import { describe, expect, it, vi } from 'vitest'
import {
  buildUsageForecast,
  daysUntilPeriodReset,
  estimateDiagnosisBill,
  fmtBillingLimit,
  formatPeriodResetLabel,
  formatPlanQuotaChip,
  monthlyQuotaWindowEnd,
} from './billingUsageForecast'

describe('monthlyQuotaWindowEnd (annual plans reset monthly)', () => {
  it('ends at the first of the next UTC month', () => {
    expect(monthlyQuotaWindowEnd('2026-10-01T00:00:00.000Z')).toBe('2026-11-01T00:00:00.000Z')
    expect(monthlyQuotaWindowEnd('2026-12-01T00:00:00.000Z')).toBe('2027-01-01T00:00:00.000Z')
  })
  it('returns null without a usable start', () => {
    expect(monthlyQuotaWindowEnd(null)).toBeNull()
    expect(monthlyQuotaWindowEnd('not a date')).toBeNull()
  })
})

describe('estimateDiagnosisBill', () => {
  const indie = {
    baseUsd: 15,
    included: 500,
    overageRate: 0.03,
    spendCapUsd: 50,
  }

  it('returns base within included diagnoses', () => {
    expect(estimateDiagnosisBill(indie, 200)).toEqual({ total: 15, capped: false })
  })

  it('adds overage and respects spend cap', () => {
    expect(estimateDiagnosisBill(indie, 2000)).toEqual({ total: 50, capped: true })
  })
})

describe('buildUsageForecast', () => {
  const periodStart = new Date(Date.now() - 10 * 86_400_000).toISOString()
  const periodEnd = new Date(Date.now() + 20 * 86_400_000).toISOString()

  it('returns null when under 24h of data', () => {
    const recent = new Date(Date.now() - 12 * 3_600_000).toISOString()
    expect(buildUsageForecast(100, 500, recent, periodEnd)).toBeNull()
  })

  it('projects quota ETA and dollar cost', () => {
    const forecast = buildUsageForecast(200, 500, periodStart, periodEnd, {
      baseUsd: 15,
      included: 500,
      overageRate: 0.03,
      spendCapUsd: 50,
    })
    expect(forecast).not.toBeNull()
    expect(forecast!.etaDays).toBeGreaterThan(0)
    expect(forecast!.projectedCostUsd).toBeGreaterThanOrEqual(15)
    expect(forecast!.projectedCostLabel).toMatch(/Projected ~\$/)
  })

  it('names a date that agrees with the day count when the limit falls inside the period', () => {
    // Pin the clock so the pace is exactly 200 over 10 days = 20/day;
    // 300 left = 15 days, inside the 20 remaining.
    const now = Date.UTC(2026, 9, 20, 12, 0, 0)
    vi.useFakeTimers()
    vi.setSystemTime(now)
    try {
      const start = new Date(now - 10 * 86_400_000).toISOString()
      const end = new Date(now + 20 * 86_400_000).toISOString()
      const forecast = buildUsageForecast(200, 500, start, end)
      expect(forecast).not.toBeNull()
      expect(forecast!.hitsThisPeriod).toBe(true)
      expect(forecast!.etaDays).toBe(15)
      expect(forecast!.etaDate.getTime()).toBe(now + 15 * 86_400_000)
      const dateStr = forecast!.etaDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      expect(forecast!.label).toBe(`At current rate, you'll hit your limit on ${dateStr} (15d away)`)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says the limit will not be hit this period instead of a far-future date', () => {
    // B8: 17 / 2,000 diagnoses, two weeks in, two weeks left — the old label
    // read "on Nov 24 (2227d away)".
    const start = new Date(Date.now() - 14 * 86_400_000).toISOString()
    const end = new Date(Date.now() + 14 * 86_400_000).toISOString()
    const forecast = buildUsageForecast(17, 2000, start, end, {
      baseUsd: 49,
      included: 2000,
      overageRate: 0.03,
      spendCapUsd: null,
    })
    expect(forecast).not.toBeNull()
    expect(forecast!.hitsThisPeriod).toBe(false)
    expect(forecast!.tone).toBe('muted')
    expect(forecast!.label).toBe("You won't hit your limit this period at the current rate")
    expect(forecast!.label).not.toMatch(/\d+d away/)
  })
})

describe('formatPlanQuotaChip', () => {
  it('shows the plan name and its diagnoses quota', () => {
    expect(formatPlanQuotaChip('Pro', 2000, 1000)).toBe('Pro: 2,000 diagnoses / mo')
  })

  it('falls back to the reports quota, then unlimited', () => {
    expect(formatPlanQuotaChip('Hobby', null, 1000)).toBe('Hobby: 1,000 reports / mo')
    expect(formatPlanQuotaChip('Enterprise', null, null)).toBe('Enterprise: unlimited')
    expect(formatPlanQuotaChip('', null, null)).toBe('Plan: unlimited')
  })
})

describe('daysUntilPeriodReset', () => {
  it('returns days until period end', () => {
    const end = new Date(Date.now() + 5 * 86_400_000).toISOString()
    expect(daysUntilPeriodReset(end)).toBe(5)
    expect(formatPeriodResetLabel(5)).toBe('Quota resets in 5 days')
  })

  it('returns null for invalid input', () => {
    expect(daysUntilPeriodReset(null)).toBeNull()
    expect(daysUntilPeriodReset('not-a-date')).toBeNull()
  })
})

describe('fmtBillingLimit', () => {
  it('includes diagnoses percentage when provided', () => {
    expect(fmtBillingLimit(0, null, 120, 500, 24)).toBe(
      '120 / 500 diagnoses · 24% used',
    )
  })

  it('falls back to reports', () => {
    expect(fmtBillingLimit(10, 100, null, null, 10)).toBe(
      '10 / 100 reports · 10% used',
    )
  })
})
