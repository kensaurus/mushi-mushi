// ============================================================
// Pricing-plan accessor — single source of truth shared by quota.ts,
// the /billing API endpoints, the stripe-webhooks handler, and the
// admin BillingPage.
//
// Loads the catalog from the `pricing_plans` table with a short warm-isolate
// cache. Plan changes ship via migrations, so an unbounded cache can keep
// stale entitlements alive until every isolate happens to recycle.
// ============================================================
import { getServiceClient } from './db.ts';
import { log } from './logger.ts';

export interface PricingPlan {
  id: 'hobby' | 'starter' | 'free_cloud' | 'indie' | 'pro' | 'enterprise' | string;
  display_name: string;
  position: number;
  monthly_price_usd: number;
  base_price_lookup_key: string | null;
  overage_price_lookup_key: string | null;
  included_reports_per_month: number | null;
  overage_unit_amount_decimal: number | null;
  /** Diagnoses quota included in the base monthly price. NULL = unlimited. */
  included_diagnoses_per_month: number | null;
  /** USD per diagnosis above included_diagnoses_per_month. NULL = hard-stop. */
  overage_unit_amount_decimal_diagnoses: number | null;
  /** Default hard spend cap for this plan (USD). NULL = no cap. */
  monthly_spend_cap_usd: number | null;
  retention_days: number;
  seat_limit: number | null;
  is_self_serve: boolean;
  active: boolean;
  feature_flags: Record<string, unknown>;
}

let cache: Map<string, PricingPlan> | null = null;
let inflight: Promise<Map<string, PricingPlan>> | null = null;
let cacheLoadedAt = 0;

const PLAN_CACHE_TTL_MS = 60_000;

const plog = log.child('plans');

/** Hardcoded fallback if the DB read fails — keeps the gateway open. */
const FREE_CLOUD_FALLBACK: PricingPlan = {
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
  feature_flags: {
    sso: false,
    byok: false,
    plugins: false,
    sla_hours: null,
    audit_log: false,
    teams: false,
  },
};

/** Legacy fallback for hobby — kept so existing hobby subs never error. */
const HOBBY_FALLBACK: PricingPlan = {
  id: 'hobby',
  display_name: 'Hobby',
  position: 0,
  monthly_price_usd: 0,
  base_price_lookup_key: null,
  overage_price_lookup_key: null,
  included_reports_per_month: 1000,
  overage_unit_amount_decimal: null,
  included_diagnoses_per_month: 1000,
  overage_unit_amount_decimal_diagnoses: null,
  monthly_spend_cap_usd: null,
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
    teams: false,
  },
};

async function loadPlans(): Promise<Map<string, PricingPlan>> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < PLAN_CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  const staleCatalog = cache;
  inflight = (async () => {
    const db = getServiceClient();
    const { data, error } = await db
      .from('pricing_plans')
      .select(
        'id, display_name, position, monthly_price_usd, base_price_lookup_key, overage_price_lookup_key, included_reports_per_month, overage_unit_amount_decimal, included_diagnoses_per_month, overage_unit_amount_decimal_diagnoses, monthly_spend_cap_usd, retention_days, seat_limit, is_self_serve, active, feature_flags',
      )
      .order('position', { ascending: true });
    if (error) {
      // Sentry MUSHI-MUSHI-SERVER-K (regressed 2026-04-23): the Supabase REST
      // gateway in front of `pricing_plans` returns transient 502/503/504 +
      // "Bad Gateway" HTML from Cloudflare during regional cold-starts (~5–10
      // events / day). The hobby fallback below already keeps the gateway
      // open, so these are NOT real errors — logging them at `error` level
      // creates Sentry noise that drowns out the genuine load failures (e.g.
      // schema drift, RLS misconfig, hard 4xx). Classify the upstream 5xx /
      // network blips as `warn` and reserve `error` for status codes that
      // actually require code or schema action.
      const code = (error as { code?: string }).code ?? null;
      const status =
        (error as { statusCode?: number }).statusCode ??
        (error as { status?: number }).status ??
        null;
      const isTransientUpstream =
        // PostgREST / Supabase relays the gateway status through `code` and
        // `statusCode`. 502/503/504 + the JS-side "fetch failed" wrapper are
        // all "external blip, retry", not "we have a bug".
        (typeof status === 'number' && status >= 500 && status < 600) ||
        code === 'PGRST301' || // pool timeout
        /(?:bad gateway|gateway timeout|fetch failed|network|temporarily unavailable)/i.test(
          error.message ?? '',
        );
      const logFields = {
        error: error.message,
        code,
        status,
        transient: isTransientUpstream,
      };
      if (isTransientUpstream) {
        plog.warn('plans_load_failed_transient', logFields);
      } else {
        plog.error('plans_load_failed', logFields);
      }
      // Keep the last known-good entitlement catalog during a transient refresh
      // failure. Falling back to free-only after a warm load would temporarily
      // revoke paid features and turn an upstream blip into tenant-facing 402s.
      // Reset the age so busy isolates retry at most once per TTL.
      if (staleCatalog) {
        cacheLoadedAt = Date.now();
        inflight = null;
        return staleCatalog;
      }

      // A cold isolate has no safe paid-plan truth to serve. Cache the
      // conservative baseline briefly so a DB outage does not cause every
      // request to stampede the catalog endpoint.
      cache = new Map<string, PricingPlan>([
        ['free_cloud', FREE_CLOUD_FALLBACK],
        ['hobby', HOBBY_FALLBACK],
      ]);
      cacheLoadedAt = Date.now();
      inflight = null;
      return cache;
    }
    cache = new Map((data ?? []).map((p) => [p.id, p as PricingPlan]));
    if (!cache.has('free_cloud')) cache.set('free_cloud', FREE_CLOUD_FALLBACK);
    if (!cache.has('hobby')) cache.set('hobby', HOBBY_FALLBACK);
    cacheLoadedAt = Date.now();
    inflight = null;
    return cache;
  })();
  return inflight;
}

export async function listPlans(): Promise<PricingPlan[]> {
  const m = await loadPlans();
  return Array.from(m.values()).sort((a, b) => a.position - b.position);
}

export async function getPlan(id: string | null | undefined): Promise<PricingPlan> {
  const m = await loadPlans();
  if (id && m.has(id)) return m.get(id)!;
  return m.get('free_cloud') ?? m.get('hobby') ?? FREE_CLOUD_FALLBACK;
}

export async function getPlanByBaseLookupKey(
  lookupKey: string | null | undefined,
): Promise<PricingPlan | null> {
  if (!lookupKey) return null;
  const m = await loadPlans();
  for (const p of m.values()) {
    if (p.base_price_lookup_key === lookupKey) return p;
  }
  return null;
}

/**
 * Map a Stripe subscription's status + metadata to the resolved plan that
 * should be applied to the project. Used by the gateway to decide quota.
 *
 * - status not in {active, trialing, past_due} → hobby (downgraded)
 * - status active/trialing → metadata.plan_id (or fallback to hobby)
 * - status past_due → keep the plan but the caller may add a grace banner
 */
export async function resolvePlanFromSubscription(
  sub: {
    status?: string | null;
    plan_id?: string | null;
  } | null,
): Promise<PricingPlan> {
  if (!sub) return getPlan('free_cloud');
  const ACTIVE = new Set(['active', 'trialing', 'past_due']);
  if (!sub.status || !ACTIVE.has(sub.status)) return getPlan('free_cloud');
  return getPlan(sub.plan_id ?? 'free_cloud');
}

/** Test-only — production hot reload happens via fresh isolate cold-start. */
export function invalidatePlanCache() {
  cache = null;
  inflight = null;
  cacheLoadedAt = 0;
}
