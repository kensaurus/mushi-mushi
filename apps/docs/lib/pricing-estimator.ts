/**
 * FILE: apps/docs/lib/pricing-estimator.ts
 * PURPOSE: Pure pricing-estimator math shared by the docs Pricing page component
 *   and unit tests. Mirrors classify-report diagnosis quota + overage cap logic.
 *
 * OVERVIEW:
 * - Tier catalog constants (Free Cloud, Indie, Pro)
 * - estimateCost() — base + overage with spend-cap clamp
 * - Annual billing helpers (2 months free ≈ 17% off)
 * - getNextTierId() — upgrade nudge when capped
 *
 * USAGE:
 *   import { estimateCost, TIERS, MAX_SLIDER } from '../lib/pricing-estimator'
 */

export interface PricingTier {
  id: string
  name: string
  baseUsd: number
  included: number
  overageUsd: number | null
  capUsd: number | null
}

export const TIERS: PricingTier[] = [
  { id: 'free_cloud', name: 'Free Cloud', baseUsd: 0, included: 50, overageUsd: null, capUsd: null },
  { id: 'indie', name: 'Indie', baseUsd: 15, included: 500, overageUsd: 0.03, capUsd: 50 },
  { id: 'pro', name: 'Pro', baseUsd: 49, included: 2000, overageUsd: 0.025, capUsd: 200 },
]

/** Pro spend cap ($200) triggers at ~8,040 diagnoses — slider must reach that. */
export const MAX_SLIDER = 10_000

export const ANNUAL_DISCOUNT_MONTHS = 2

export const POPULAR_TIER_ID = 'indie'

export interface CostEstimate {
  total: number
  overage: number
  capped: boolean
}

export function estimateCost(tier: PricingTier, diagnoses: number): CostEstimate {
  const overCount = Math.max(0, diagnoses - tier.included)
  if (tier.overageUsd === null) {
    return { total: tier.baseUsd, overage: 0, capped: overCount > 0 }
  }
  const overageCost = overCount * tier.overageUsd
  const maxOverage = tier.capUsd !== null ? tier.capUsd - tier.baseUsd : Infinity
  const clampedOverage = Math.min(overageCost, maxOverage)
  const capped =
    maxOverage !== Infinity && overCount > 0 && overageCost >= maxOverage
  return { total: tier.baseUsd + clampedOverage, overage: clampedOverage, capped }
}

/** Monthly list price with optional annual billing (pay 10 months, get 12). */
export function displayBaseUsd(tier: PricingTier, annual: boolean): number {
  if (!annual || tier.baseUsd <= 0) return tier.baseUsd
  return Math.round((tier.baseUsd * (12 - ANNUAL_DISCOUNT_MONTHS)) / 12 * 100) / 100
}

export function annualTotalUsd(tier: PricingTier): number {
  if (tier.baseUsd <= 0) return 0
  return tier.baseUsd * (12 - ANNUAL_DISCOUNT_MONTHS)
}

export function getNextTierId(tierId: string): string | null {
  if (tierId === 'free_cloud') return 'indie'
  if (tierId === 'indie') return 'pro'
  return null
}

export function getTierById(tierId: string): PricingTier {
  return TIERS.find((t) => t.id === tierId) ?? TIERS[1]
}

/** Diagnoses count at which a paid tier hits its spend cap (for docs copy). */
export function diagnosesAtSpendCap(tier: PricingTier): number | null {
  if (tier.overageUsd === null || tier.capUsd === null) return null
  const maxOverage = tier.capUsd - tier.baseUsd
  if (maxOverage <= 0) return tier.included
  return tier.included + Math.floor(maxOverage / tier.overageUsd)
}
