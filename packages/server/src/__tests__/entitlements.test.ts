/**
 * Plan-level feature-gate test matrix.
 *
 * What this guards against
 * ────────────────────────
 * - Migration drift: someone edits `feature_flags` on `pricing_plans` and
 *   accidentally drops `byok` from Starter or grants `sso` on Hobby. CI
 *   catches it before it ships.
 * - Middleware regression: `requireFeature` is bypassed by a refactor and
 *   silently lets a Hobby caller through. The matrix below renders an
 *   explicit truth table — every row is asserted.
 * - Helper drift: `minimumPlanFor(flag)` walks the catalog in `position`
 *   order; if someone reorders or renames a plan id, the test fails loud.
 *
 * Why no real Hono app + Supabase
 * ───────────────────────────────
 * `requireFeature` reduces to: resolve plan → `plan.feature_flags[flag]`.
 * That decision is the only thing worth testing in isolation; a full
 * Hono integration test would buy a slow, brittle test for no extra
 * coverage. We DO mock the Deno-only modules (`db.ts`, `plans.ts`) so
 * the middleware can run under Node/Vitest, then exercise it against a
 * fake Hono context to assert the response shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PricingPlan } from '../../supabase/functions/_shared/plans.ts'

// ─── Catalog mirror ────────────────────────────────────────────────────────
// Mirrors `20260419000000_billing_plans.sql`. Kept in sync MANUALLY: if
// the migration changes, this constant has to change too — that's the
// CI guard. Do NOT loosen the assertions to make the test pass without
// also auditing the migration.

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
  feature_flags: {
    sso: false,
    byok: false,
    plugins: false,
    sla_hours: null,
    audit_log: false,
    intelligence_reports: false,
  },
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
  feature_flags: {
    sso: false,
    byok: true,
    plugins: true,
    sla_hours: 48,
    audit_log: true,
    intelligence_reports: false,
  },
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
  feature_flags: {
    sso: true,
    byok: true,
    plugins: true,
    sla_hours: 8,
    audit_log: true,
    intelligence_reports: true,
  },
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
  feature_flags: {
    sso: true,
    byok: true,
    plugins: true,
    sla_hours: 4,
    audit_log: true,
    intelligence_reports: true,
    self_hosted: true,
    soc2: true,
  },
}

const ALL_PLANS = [HOBBY, STARTER, PRO, ENTERPRISE]

// Stub out Deno-only modules before importing the SUT. Vitest hoists vi.mock.
//
// The middleware does `db.from(...).select(...).eq(...).in(...).order(...).limit(...).maybeSingle()`
// to read `billing_subscriptions`, then passes the sub to
// `resolvePlanFromSubscription` (mocked separately). So the chain just
// needs to resolve to an arbitrary sub-shaped object — the actual plan
// resolution is driven by `planState.active` below.
function makeQueryChain(): Record<string, unknown> {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => ({ data: { id: 'proj-test' }, error: null }),
    maybeSingle: async () => ({
      data: { status: 'active', plan_id: 'mocked' },
      error: null,
    }),
  }
  return chain
}

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({
    from: () => makeQueryChain(),
  }),
}))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

const planState = {
  active: HOBBY as PricingPlan,
}

vi.mock('../../supabase/functions/_shared/plans.ts', async () => {
  return {
    loadPlans: async () => new Map(ALL_PLANS.map((p) => [p.id, p])),
    listPlans: async () => [...ALL_PLANS],
    getPlan: async (id: string) =>
      ALL_PLANS.find((p) => p.id === id) ?? HOBBY,
    resolvePlanFromSubscription: async () => planState.active,
  }
})

const {
  requireFeature,
  minimumPlanFor,
  GATED_ROUTES,
} = await import('../../supabase/functions/_shared/entitlements.ts')

// ─── Helper: fake Hono context ─────────────────────────────────────────────
function makeCtx(overrides: { userId?: string; projectId?: string; path?: string; method?: string } = {}) {
  const store = new Map<string, unknown>()
  store.set('userId', overrides.userId ?? 'user-test')
  if (overrides.projectId) store.set('projectId', overrides.projectId)
  let lastResponse: { status: number; body: unknown } | null = null

  // We can't avoid the DB lookup for `projects.owner_id = userId` when
  // projectId isn't pre-populated, so we always pre-set it to skip the
  // query. Real callers either come with one (API key path) or hit
  // the SQL projection (JWT path) — both terminate at the same shape.
  if (!store.has('projectId')) store.set('projectId', 'proj-test')

  const ctx = {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => { store.set(k, v) },
    req: {
      path: overrides.path ?? '/v1/admin/sso',
      method: overrides.method ?? 'POST',
    },
    json: (body: unknown, status?: number) => {
      lastResponse = { status: status ?? 200, body }
      return { status: status ?? 200, body }
    },
  }
  return {
    ctx,
    getResponse: () => lastResponse,
  }
}

describe('GATED_ROUTES catalog', () => {
  it('covers every paid surface listed in the production-readiness plan', () => {
    const flags = new Set(GATED_ROUTES.map((r) => r.flag))
    expect(flags).toEqual(new Set(['sso', 'byok', 'plugins', 'intelligence_reports']))
  })

  it('uses route prefixes that exist in api/index.ts', () => {
    const prefixes = GATED_ROUTES.map((r) => r.prefix)
    expect(prefixes).toEqual([
      '/v1/admin/sso',
      '/v1/admin/byok',
      '/v1/admin/plugins',
      '/v1/admin/intelligence',
    ])
  })
})

describe('minimumPlanFor', () => {
  it('returns the cheapest plan that grants each gated flag', async () => {
    expect((await minimumPlanFor('byok'))?.id).toBe('starter')
    expect((await minimumPlanFor('plugins'))?.id).toBe('starter')
    expect((await minimumPlanFor('audit_log'))?.id).toBe('starter')
    expect((await minimumPlanFor('sso'))?.id).toBe('pro')
    expect((await minimumPlanFor('intelligence_reports'))?.id).toBe('pro')
    expect((await minimumPlanFor('soc2'))?.id).toBe('enterprise')
    expect((await minimumPlanFor('self_hosted'))?.id).toBe('enterprise')
  })
})

describe('requireFeature middleware (gated-route × plan-tier matrix)', () => {
  // Truth table — explicitly enumerated so a migration drift forces the
  // test to be touched.
  const matrix: Array<{
    plan: PricingPlan
    expectations: Record<'sso' | 'byok' | 'plugins' | 'intelligence_reports', boolean>
  }> = [
    {
      plan: HOBBY,
      expectations: { sso: false, byok: false, plugins: false, intelligence_reports: false },
    },
    {
      plan: STARTER,
      expectations: { sso: false, byok: true, plugins: true, intelligence_reports: false },
    },
    {
      plan: PRO,
      expectations: { sso: true, byok: true, plugins: true, intelligence_reports: true },
    },
    {
      plan: ENTERPRISE,
      expectations: { sso: true, byok: true, plugins: true, intelligence_reports: true },
    },
  ]

  beforeEach(() => {
    planState.active = HOBBY
  })

  for (const row of matrix) {
    for (const [flag, expectedAllowed] of Object.entries(row.expectations) as Array<
      ['sso' | 'byok' | 'plugins' | 'intelligence_reports', boolean]
    >) {
      it(
        `${row.plan.id} → ${flag}: ${expectedAllowed ? 'allowed (200)' : 'blocked (402)'}`,
        async () => {
          planState.active = row.plan
          const { ctx, getResponse } = makeCtx({ method: 'POST' })
          let nextCalled = false
          const next = async () => { nextCalled = true }

          await requireFeature(flag)(ctx as unknown as Parameters<ReturnType<typeof requireFeature>>[0], next)

          if (expectedAllowed) {
            expect(nextCalled, `next() should fire for ${row.plan.id}/${flag}`).toBe(true)
            expect(getResponse(), `no early response for ${row.plan.id}/${flag}`).toBeNull()
            // The middleware sets `entitlement` so handlers can reuse the resolved plan.
            expect((ctx.get('entitlement') as { plan: PricingPlan }).plan.id).toBe(row.plan.id)
          } else {
            expect(nextCalled, `next() must NOT fire for ${row.plan.id}/${flag}`).toBe(false)
            const res = getResponse()
            expect(res?.status).toBe(402)
            const body = res?.body as {
              ok: boolean
              error: { code: string; flag: string; current_plan: string; upgrade_to: { id: string } | null }
            }
            expect(body.ok).toBe(false)
            expect(body.error.code).toBe('feature_not_in_plan')
            expect(body.error.flag).toBe(flag)
            expect(body.error.current_plan).toBe(row.plan.id)
            // Hobby/Starter blocked on a flag → upgrade_to MUST be set
            // (every catalogued flag has at least one plan that grants it).
            expect(body.error.upgrade_to?.id).toBeDefined()
          }
        },
      )
    }
  }
})
