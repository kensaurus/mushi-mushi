import { describe, expect, it } from 'vitest'
import {
  buildUsageForecast,
  daysUntilPeriodReset,
  estimateDiagnosisBill,
  fmtBillingLimit,
  formatPeriodResetLabel,
} from './billingUsageForecast'

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
