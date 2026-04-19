// ============================================================
// Pricing-plan accessor — single source of truth shared by quota.ts,
// the /billing API endpoints, the stripe-webhooks handler, and the
// admin BillingPage.
//
// Loads the catalog from the `pricing_plans` table once per warm
// invocation. Edge function isolates die after a few minutes of idle,
// so we cache without TTL — `invalidatePlanCache()` exists only for
// tests; real catalog changes ship via migrations.
// ============================================================
import { getServiceClient } from './db.ts'
import { log } from './logger.ts'

export interface PricingPlan {
  id: 'hobby' | 'starter' | 'pro' | 'enterprise' | string
  display_name: string
  position: number
  monthly_price_usd: number
  base_price_lookup_key: string | null
  overage_price_lookup_key: string | null
  included_reports_per_month: number | null
  overage_unit_amount_decimal: number | null
  retention_days: number
  seat_limit: number | null
  is_self_serve: boolean
  active: boolean
  feature_flags: Record<string, unknown>
}

let cache: Map<string, PricingPlan> | null = null
let inflight: Promise<Map<string, PricingPlan>> | null = null

const plog = log.child('plans')

/** Hardcoded fallback if the DB read fails — keeps the gateway open. */
const HOBBY_FALLBACK: PricingPlan = {
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
  feature_flags: { sso: false, byok: false, plugins: false, sla_hours: null, audit_log: false },
}

async function loadPlans(): Promise<Map<string, PricingPlan>> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    const db = getServiceClient()
    const { data, error } = await db
      .from('pricing_plans')
      .select(
        'id, display_name, position, monthly_price_usd, base_price_lookup_key, overage_price_lookup_key, included_reports_per_month, overage_unit_amount_decimal, retention_days, seat_limit, is_self_serve, active, feature_flags',
      )
      .eq('active', true)
      .order('position', { ascending: true })
    if (error) {
      plog.error('plans_load_failed', { error: error.message })
      // Fail open with a hobby-only catalog so quota.ts still has a baseline.
      const fallback = new Map<string, PricingPlan>([['hobby', HOBBY_FALLBACK]])
      inflight = null
      return fallback
    }
    cache = new Map((data ?? []).map((p) => [p.id, p as PricingPlan]))
    if (!cache.has('hobby')) cache.set('hobby', HOBBY_FALLBACK)
    inflight = null
    return cache
  })()
  return inflight
}

export async function listPlans(): Promise<PricingPlan[]> {
  const m = await loadPlans()
  return Array.from(m.values()).sort((a, b) => a.position - b.position)
}

export async function getPlan(id: string | null | undefined): Promise<PricingPlan> {
  const m = await loadPlans()
  if (id && m.has(id)) return m.get(id)!
  return m.get('hobby') ?? HOBBY_FALLBACK
}

export async function getPlanByBaseLookupKey(
  lookupKey: string | null | undefined,
): Promise<PricingPlan | null> {
  if (!lookupKey) return null
  const m = await loadPlans()
  for (const p of m.values()) {
    if (p.base_price_lookup_key === lookupKey) return p
  }
  return null
}

/**
 * Map a Stripe subscription's status + metadata to the resolved plan that
 * should be applied to the project. Used by the gateway to decide quota.
 *
 * - status not in {active, trialing, past_due} → hobby (downgraded)
 * - status active/trialing → metadata.plan_id (or fallback to hobby)
 * - status past_due → keep the plan but the caller may add a grace banner
 */
export async function resolvePlanFromSubscription(sub: {
  status?: string | null
  plan_id?: string | null
} | null): Promise<PricingPlan> {
  if (!sub) return getPlan('hobby')
  const ACTIVE = new Set(['active', 'trialing', 'past_due'])
  if (!sub.status || !ACTIVE.has(sub.status)) return getPlan('hobby')
  return getPlan(sub.plan_id ?? 'hobby')
}

/** Test-only — production hot reload happens via fresh isolate cold-start. */
export function invalidatePlanCache() {
  cache = null
  inflight = null
}
