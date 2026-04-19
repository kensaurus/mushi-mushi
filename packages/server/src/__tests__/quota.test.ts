/**
 * Unit tests for the plan-aware ingest quota decision.
 *
 * The pure decision logic lives in `decideQuota` (extracted from quota.ts so
 * we don't need a Supabase client to test it). Covers every branch in the
 * tier matrix:
 *
 *   - Hobby under quota             → allowed, no overage
 *   - Hobby at quota                → 402, NO_SUBSCRIPTION_OVER_FREE
 *   - Starter under included        → allowed, no overage
 *   - Starter over included         → allowed, overage=true (metered)
 *   - Pro over included             → allowed, overage=true (metered, lower rate)
 *   - Enterprise (unlimited)        → allowed regardless of usage
 *   - Subscribed plan with no overage SKU at limit → 402, OVER_INCLUDED_NO_OVERAGE
 *
 * The function is also imported via the Deno-style relative `.ts` import path
 * — Vitest resolves `.ts` extensions transparently via Vite's module graph,
 * so no compilation step is required.
 */

import { describe, it, expect, vi } from 'vitest'

// `quota.ts` is a Deno-runtime file that transitively imports `db.ts`, which
// pulls in `npm:@supabase/supabase-js`. Vitest (Node) can't resolve `npm:`
// specifiers, so we stub the side-effecty modules out before the import.
// `vi.mock` is hoisted above the `import` statements at compile time.
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

import { decideQuota, type QuotaVerdict } from '../../supabase/functions/_shared/quota.ts'
import type { PricingPlan } from '../../supabase/functions/_shared/plans.ts'

const PERIOD_RESETS = '2026-05-01T00:00:00.000Z'
const PERIOD_END = new Date(PERIOD_RESETS)
const NOW = new Date('2026-04-19T00:00:00.000Z')

const HOBBY: PricingPlan = {
  id: 'hobby',
  display_name: 'Hobby',
  position: 0,
  monthly_price_usd: 0,
  base_price_lookup_key: null,
  overage_price_lookup_key: null,
  included_reports_per_month: 1000,
  overage_unit_amount_decimal: null,
  retention_days: 7,
  seat_limit: 3,
  is_self_serve: true,
  active: true,
  feature_flags: {},
}

const STARTER: PricingPlan = {
  id: 'starter',
  display_name: 'Starter',
  position: 1,
  monthly_price_usd: 19,
  base_price_lookup_key: 'mushi:starter:base:v1',
  overage_price_lookup_key: 'mushi:reports:overage:starter:v1',
  included_reports_per_month: 10_000,
  overage_unit_amount_decimal: 0.0025,
  retention_days: 30,
  seat_limit: null,
  is_self_serve: true,
  active: true,
  feature_flags: {},
}

const PRO: PricingPlan = {
  id: 'pro',
  display_name: 'Pro',
  position: 2,
  monthly_price_usd: 99,
  base_price_lookup_key: 'mushi:pro:base:v1',
  overage_price_lookup_key: 'mushi:reports:overage:pro:v1',
  included_reports_per_month: 50_000,
  overage_unit_amount_decimal: 0.002,
  retention_days: 90,
  seat_limit: null,
  is_self_serve: true,
  active: true,
  feature_flags: {},
}

const ENTERPRISE: PricingPlan = {
  id: 'enterprise',
  display_name: 'Enterprise',
  position: 3,
  monthly_price_usd: 0,
  base_price_lookup_key: null,
  overage_price_lookup_key: null,
  included_reports_per_month: null,
  overage_unit_amount_decimal: null,
  retention_days: 365,
  seat_limit: null,
  is_self_serve: false,
  active: true,
  feature_flags: { sso: true },
}

const SUBSCRIBED_PLAN_NO_OVERAGE: PricingPlan = {
  ...STARTER,
  id: 'starter-grandfathered',
  display_name: 'Starter (legacy)',
  overage_price_lookup_key: null,
}

function decide(opts: {
  plan: PricingPlan
  used: number
  hasSubscription: boolean
}): QuotaVerdict {
  return decideQuota({
    plan: opts.plan,
    used: opts.used,
    hasSubscription: opts.hasSubscription,
    periodResetsAt: PERIOD_RESETS,
    periodEnd: PERIOD_END,
    now: NOW,
  })
}

describe('decideQuota — Hobby (free)', () => {
  it('allows ingest under the included 1k cap', () => {
    const v = decide({ plan: HOBBY, used: 999, hasSubscription: false })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(false)
    expect(v.limit).toBe(1000)
    expect(v.plan.id).toBe('hobby')
    expect(v.retryAfterSeconds).toBeNull()
  })

  it('blocks at the 1k cap with NO_SUBSCRIPTION_OVER_FREE', () => {
    const v = decide({ plan: HOBBY, used: 1000, hasSubscription: false })
    expect(v.allowed).toBe(false)
    expect(v.overage).toBe(false)
    expect(v.reason).toBe('NO_SUBSCRIPTION_OVER_FREE')
    expect(v.used).toBe(1000)
    expect(v.limit).toBe(1000)
    expect(v.retryAfterSeconds).toBeGreaterThan(0)
    // Retry-After is whole seconds until the period rolls over.
    const expectedRetry = Math.floor((PERIOD_END.getTime() - NOW.getTime()) / 1000)
    expect(v.retryAfterSeconds).toBe(expectedRetry)
  })

  it('blocks well above the cap', () => {
    const v = decide({ plan: HOBBY, used: 5000, hasSubscription: false })
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('NO_SUBSCRIPTION_OVER_FREE')
  })
})

describe('decideQuota — Starter ($19/mo, metered overage)', () => {
  it('allows under the included 10k cap with no overage flag', () => {
    const v = decide({ plan: STARTER, used: 9_999, hasSubscription: true })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(false)
    expect(v.plan.id).toBe('starter')
    expect(v.limit).toBe(10_000)
  })

  it('flips overage=true at the 10k cap (still allowed, billed per report)', () => {
    const v = decide({ plan: STARTER, used: 10_000, hasSubscription: true })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(true)
    expect(v.reason).toBeUndefined()
    expect(v.retryAfterSeconds).toBeNull()
  })

  it('keeps overage flag at high usage', () => {
    const v = decide({ plan: STARTER, used: 50_000, hasSubscription: true })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(true)
  })
})

describe('decideQuota — Pro ($99/mo, lower overage rate)', () => {
  it('allows under the included 50k cap', () => {
    const v = decide({ plan: PRO, used: 25_000, hasSubscription: true })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(false)
    expect(v.plan.id).toBe('pro')
  })

  it('flips overage=true at the 50k cap', () => {
    const v = decide({ plan: PRO, used: 50_000, hasSubscription: true })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(true)
  })
})

describe('decideQuota — Enterprise (unlimited)', () => {
  it('allows zero usage', () => {
    const v = decide({ plan: ENTERPRISE, used: 0, hasSubscription: true })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(false)
    expect(v.limit).toBeNull()
  })

  it('allows astronomical usage', () => {
    const v = decide({ plan: ENTERPRISE, used: 10_000_000, hasSubscription: true })
    expect(v.allowed).toBe(true)
    expect(v.overage).toBe(false)
    expect(v.limit).toBeNull()
    expect(v.retryAfterSeconds).toBeNull()
  })
})

describe('decideQuota — subscribed plan without overage SKU', () => {
  it('returns OVER_INCLUDED_NO_OVERAGE (not the unsubscribed reason)', () => {
    const v = decide({
      plan: SUBSCRIBED_PLAN_NO_OVERAGE,
      used: 10_000,
      hasSubscription: true,
    })
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('OVER_INCLUDED_NO_OVERAGE')
    expect(v.plan.id).toBe('starter-grandfathered')
    expect(v.retryAfterSeconds).toBeGreaterThan(0)
  })
})

describe('decideQuota — period rollover math', () => {
  it('caps Retry-After to a sane positive integer', () => {
    const v = decide({ plan: HOBBY, used: 1000, hasSubscription: false })
    expect(Number.isInteger(v.retryAfterSeconds)).toBe(true)
    expect(v.retryAfterSeconds! > 0).toBe(true)
  })

  it('returns at least 1 second even when the window has already closed', () => {
    const closedWindowEnd = new Date(NOW.getTime() - 1)
    const v = decideQuota({
      plan: HOBBY,
      used: 1000,
      hasSubscription: false,
      periodResetsAt: PERIOD_RESETS,
      periodEnd: closedWindowEnd,
      now: NOW,
    })
    expect(v.retryAfterSeconds).toBe(1)
  })
})
