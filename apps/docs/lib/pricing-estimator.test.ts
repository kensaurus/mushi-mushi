import { describe, expect, it } from 'vitest'
import {
  ANNUAL_DISCOUNT_MONTHS,
  MAX_SLIDER,
  TIERS,
  annualTotalUsd,
  diagnosesAtSpendCap,
  displayBaseUsd,
  estimateCost,
  getNextTierId,
  getTierById,
} from './pricing-estimator'

describe('estimateCost', () => {
  const indie = getTierById('indie')
  const pro = getTierById('pro')
  const free = getTierById('free_cloud')

  it('returns base only within included quota', () => {
    expect(estimateCost(indie, 300)).toEqual({ total: 15, overage: 0, capped: false })
  })

  it('computes overage below cap', () => {
    expect(estimateCost(indie, 700)).toEqual({ total: 21, overage: 6, capped: false })
  })

  it('clamps Indie at $50 spend cap', () => {
    expect(estimateCost(indie, 5000)).toEqual({ total: 50, overage: 35, capped: true })
  })

  it('hard-stops Free Cloud with capped flag', () => {
    expect(estimateCost(free, 100)).toEqual({ total: 0, overage: 0, capped: true })
  })

  it('shows Pro spend cap within slider range', () => {
    const atCap = diagnosesAtSpendCap(pro)
    expect(atCap).toBe(8040)
    expect(atCap).toBeLessThanOrEqual(MAX_SLIDER)
    const atCapResult = estimateCost(pro, atCap!)
    expect(atCapResult.total).toBe(200)
    expect(atCapResult.capped).toBe(true)
  })
})

describe('annual pricing', () => {
  it('applies two months free on annual display', () => {
    const indie = getTierById('indie')
    expect(annualTotalUsd(indie)).toBe(15 * (12 - ANNUAL_DISCOUNT_MONTHS))
    expect(displayBaseUsd(indie, true)).toBeCloseTo(12.5, 2)
    expect(displayBaseUsd(indie, false)).toBe(15)
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
  it('has three self-serve cloud tiers', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['free_cloud', 'indie', 'pro'])
  })
})
