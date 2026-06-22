/**
 * Unit tests for the plan-aware diagnosis quota decision.
 *
 * The pure decision logic lives in `decideDiagnosisQuota` (extracted from
 * quota.ts so we don't need a Supabase client). Covers the launch-critical
 * branches:
 *
 *   - Free Cloud under quota          → allowed, no overage
 *   - Free Cloud at 50 diagnoses      → 402, NO_SUBSCRIPTION_OVER_FREE (hard stop)
 *   - Indie under included            → allowed, no overage
 *   - Indie in overage under cap      → allowed, overage=true
 *   - Indie at spend cap              → 402, SPEND_CAP_REACHED (hard stop)
 *   - Enterprise (unlimited)          → allowed regardless of usage
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({}),
}))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/plans.ts', () => ({
  getPlan: async () => ({}),
  resolvePlanFromSubscription: async () => ({}),
}))

import {
  decideDiagnosisQuota,
  type DiagnosisQuotaVerdict,
} from '../../supabase/functions/_shared/quota.ts'
import type { PricingPlan } from '../../supabase/functions/_shared/plans.ts'

const PERIOD_RESETS = '2026-05-01T00:00:00.000Z'

const FREE_CLOUD: PricingPlan = {
  id: 'free_cloud',
  display_name: 'Free Cloud',
  position: 10,
  monthly_price_usd: 0,
  base_price_lookup_key: null,
  overage_price_lookup_key: null,
  included_reports_per_month: null,
  overage_unit_amount_decimal: null,
  included_diagnoses_per_month: 50,
  overage_unit_amount_decimal_diagnoses: null,
  monthly_spend_cap_usd: null,
  retention_days: 7,
  seat_limit: 1,
  is_self_serve: true,
  active: true,
  feature_flags: {},
}

const INDIE: PricingPlan = {
  id: 'indie',
  display_name: 'Indie',
  position: 11,
  monthly_price_usd: 15,
  base_price_lookup_key: 'mushi:indie:base:v1',
  overage_price_lookup_key: 'mushi:diagnoses:overage:indie:v1',
  included_reports_per_month: null,
  overage_unit_amount_decimal: null,
  included_diagnoses_per_month: 500,
  overage_unit_amount_decimal_diagnoses: 0.03,
  monthly_spend_cap_usd: 50,
  retention_days: 30,
  seat_limit: 1,
  is_self_serve: true,
  active: true,
  feature_flags: {},
}

const PRO: PricingPlan = {
  id: 'pro',
  display_name: 'Pro',
  position: 12,
  monthly_price_usd: 49,
  base_price_lookup_key: 'mushi:pro:base:v1',
  overage_price_lookup_key: 'mushi:diagnoses:overage:pro:v1',
  included_reports_per_month: null,
  overage_unit_amount_decimal: null,
  included_diagnoses_per_month: 2000,
  overage_unit_amount_decimal_diagnoses: 0.025,
  monthly_spend_cap_usd: 200,
  retention_days: 90,
  seat_limit: 5,
  is_self_serve: true,
  active: true,
  feature_flags: {},
}

const ENTERPRISE: PricingPlan = {
  id: 'enterprise',
  display_name: 'Enterprise',
  position: 13,
  monthly_price_usd: 0,
  base_price_lookup_key: null,
  overage_price_lookup_key: null,
  included_reports_per_month: null,
  overage_unit_amount_decimal: null,
  included_diagnoses_per_month: null,
  overage_unit_amount_decimal_diagnoses: null,
  monthly_spend_cap_usd: null,
  retention_days: 365,
  seat_limit: null,
  is_self_serve: false,
  active: true,
  feature_flags: { sso: true },
}

function decide(opts: {
  plan: PricingPlan
  used: number
  hasSubscription: boolean
  spendCapUsd?: number | null
}): DiagnosisQuotaVerdict {
  return decideDiagnosisQuota({
    plan: opts.plan,
    used: opts.used,
    hasSubscription: opts.hasSubscription,
    spendCapUsd: opts.spendCapUsd ?? opts.plan.monthly_spend_cap_usd ?? null,
    periodResetsAt: PERIOD_RESETS,
  })
}

describe('decideDiagnosisQuota — Free Cloud (hard stop at 50)', () => {
  it('allows classification under the included cap', () => {
    const v = decide({ plan: FREE_CLOUD, used: 49, hasSubscription: false })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(false)
    expect(v.limit).toBe(50)
  })

  it('blocks at 50 with NO_SUBSCRIPTION_OVER_FREE — never calls LLM', () => {
    const v = decide({ plan: FREE_CLOUD, used: 50, hasSubscription: false })
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('NO_SUBSCRIPTION_OVER_FREE')
    expect(v.overage).toBe(false)
  })
})

describe('decideDiagnosisQuota — Indie ($15/mo, metered overage + cap)', () => {
  it('allows under the included 500 cap', () => {
    const v = decide({ plan: INDIE, used: 499, hasSubscription: true })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(false)
  })

  it('allows overage when spend is under the $50 cap', () => {
    // 700 used → 200 overage × $0.03 = $6 overage spend
    const v = decide({ plan: INDIE, used: 700, hasSubscription: true })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(true)
  })

  it('blocks with SPEND_CAP_REACHED when overage spend hits cap', () => {
    // 2166 used → 1666 overage × $0.03 = $49.98 (under cap)
    const under = decide({ plan: INDIE, used: 2166, hasSubscription: true })
    expect(under.allowed).toBe(true)

    // 2167 used → 1667 × $0.03 = $50.01 (at/above cap)
    const v = decide({ plan: INDIE, used: 2167, hasSubscription: true })
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('SPEND_CAP_REACHED')
    expect(v.overage).toBe(true)
  })
})

describe('decideDiagnosisQuota — Pro ($49/mo)', () => {
  it('allows under 2,000 included', () => {
    const v = decide({ plan: PRO, used: 1999, hasSubscription: true })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(false)
  })
})

describe('decideDiagnosisQuota — Enterprise (unlimited)', () => {
  it('allows astronomical usage', () => {
    const v = decide({ plan: ENTERPRISE, used: 1_000_000, hasSubscription: true })
    expect(v.allowed).toBe(true)
    expect(v.limit).toBeNull()
  })
})
