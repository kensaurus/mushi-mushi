import { describe, expect, it } from 'vitest'
import {
  ANNUAL_DISCOUNT_MONTHS,
  MAX_SLIDER,
  TIERS,
  annualTotalUsd,
  displayBaseUsd,
  estimateCost,
  getNextTierId,
  getTierById,
} from './pricing-estimator'

describe('estimateCost', () => {
  const indie = getTierById('indie')
  const pro = getTierById('pro')
  const free = getTierById('free_cloud')

  it('returns base only within included diagnoses', () => {
    expect(estimateCost(indie, 800)).toEqual({ total: 29, overage: 0, capped: false })
  })

  it('computes overage below cap', () => {
    expect(estimateCost(indie, 1200)).toEqual({ total: 35, overage: 6, capped: false })
  })

  it('clamps Builder at its $50 spend cap', () => {
    expect(estimateCost(indie, 5000)).toEqual({ total: 50, overage: 21, capped: true })
  })

  it('hard-stops Free past 100 diagnoses', () => {
    expect(estimateCost(free, 100)).toEqual({ total: 0, overage: 0, capped: false })
    expect(estimateCost(free, 101)).toEqual({ total: 0, overage: 0, capped: true })
  })

  it('shows the Studio spend cap within slider range', () => {
    // Studio's included diagnoses plus (cap - base) / overage price: 5,000 + 121 / 0.02.
    const atCap = 11050
    expect(atCap).toBeLessThanOrEqual(MAX_SLIDER)
    const atCapResult = estimateCost(pro, atCap)
    expect(atCapResult.total).toBe(200)
    expect(atCapResult.capped).toBe(true)
  })

  // Annual plans stop at the included diagnoses (no overage, 2026-10-10).
  it('annual Builder: discounted base, no overage, hard stop above 1,000', () => {
    expect(estimateCost(indie, 300, true).total).toBeCloseTo(24.17, 2)
    expect(estimateCost(indie, 5000, true)).toMatchObject({ overage: 0, capped: true })
  })

  it('annual toggle leaves the free plan unchanged', () => {
    expect(estimateCost(free, 101, true)).toEqual({ total: 0, overage: 0, capped: true })
  })
})

describe('annual pricing', () => {
  it('applies two months free on annual display', () => {
    const indie = getTierById('indie')
    expect(annualTotalUsd(indie)).toBe(290)
    expect(annualTotalUsd(getTierById('pro'))).toBe(790)
    expect(displayBaseUsd(indie, true)).toBeCloseTo(24.17, 2)
    expect(displayBaseUsd(indie, false)).toBe(29)
    expect(ANNUAL_DISCOUNT_MONTHS).toBe(2)
  })
})

describe('getNextTierId', () => {
  it('suggests upgrade path when capped', () => {
    expect(getNextTierId('free_cloud')).toBe('indie')
    expect(getNextTierId('indie')).toBe('pro')
    expect(getNextTierId('pro')).toBeNull()
  })
})

describe('TIERS catalog', () => {
  it('has three self-serve cloud tiers named Free, Builder and Studio, sold by apps', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['free_cloud', 'indie', 'pro'])
    expect(TIERS.map((t) => [t.name, t.apps, t.baseUsd, t.included])).toEqual([
      ['Free', 1, 0, 100],
      ['Builder', 3, 29, 1000],
      ['Studio', 10, 79, 5000],
    ])
  })
})
