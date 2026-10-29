/**
 * FILE: apps/docs/lib/pricing-estimator.ts
 * PURPOSE: Pure pricing-estimator math shared by the docs Pricing page component
 *   and unit tests. Mirrors classify-report diagnosis quota + overage cap logic.
 *
 * OVERVIEW:
 * - Tier catalog constants (Free, Builder, Studio): apps watched is the
 *   headline limit, diagnoses the one meter (docs/plan-pricing.md, 2026-10-28)
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
  /** Apps a team can watch on this plan. */
  apps: number
  baseUsd: number
  included: number
  overageUsd: number | null
  capUsd: number | null
}

export const TIERS: PricingTier[] = [
  { id: 'free_cloud', name: 'Free', apps: 1, baseUsd: 0, included: 100, overageUsd: null, capUsd: null },
  { id: 'indie', name: 'Builder', apps: 3, baseUsd: 29, included: 1000, overageUsd: 0.03, capUsd: 50 },
  { id: 'pro', name: 'Studio', apps: 10, baseUsd: 79, included: 3000, overageUsd: 0.03, capUsd: 200 },
]

/** Studio's spend cap ($200) triggers at 7,034 diagnoses — the slider must reach that. */
export const MAX_SLIDER = 10_000

export const ANNUAL_DISCOUNT_MONTHS = 2

export const POPULAR_TIER_ID = 'indie'

export interface CostEstimate {
  total: number
  overage: number
  capped: boolean
}

/**
 * Annual paid plans have no pay-as-you-go overage: they stop at the included
 * diagnoses each month (owner decision 2026-10-10; the server's diagnosis
 * gate enforces it). Their monthly-equivalent base is the annual discount.
 */
export function estimateCost(tier: PricingTier, diagnoses: number, annual = false): CostEstimate {
  const overCount = Math.max(0, diagnoses - tier.included)
  if (annual && tier.baseUsd > 0) {
    return { total: displayBaseUsd(tier, true), overage: 0, capped: overCount > 0 }
  }
  if (tier.overageUsd === null) {
    return { total: tier.baseUsd, overage: 0, capped: overCount > 0 }
  }
  const overageCost = overCount * tier.overageUsd
  // The cap limits overage spend, on top of the base price: the server stops new
  // diagnoses once overage reaches it (_shared/quota.ts, SPEND_CAP_REACHED).
  const maxOverage = tier.capUsd !== null ? tier.capUsd : Infinity
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
