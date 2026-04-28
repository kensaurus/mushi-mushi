// ============================================================
// Plan-feature entitlement middleware.
//
// Why this exists: every paid endpoint (/v1/admin/sso, /v1/admin/byok,
// /v1/admin/plugins, /v1/admin/intelligence) used to gate only on `jwtAuth`
// + `projects.owner_id = userId`, with no check that the caller's plan
// actually includes the feature. A Hobby user with a valid JWT could
// configure SSO, attach BYOK keys, install plugins, and queue
// intelligence reports by hitting the API directly — bypassing the
// feature-flag gates the admin frontend respects.
//
// `requireFeature(flag)` is a Hono middleware that:
//   1. Resolves the active project (from `c.get('projectId')` for
//      API-key callers, else from `projects.owner_id = userId` for JWT
//      callers — the same projection every existing handler uses).
//   2. Resolves the active billing subscription via
//      `resolvePlanFromSubscription` (single source of truth shared with
//      `quota.ts` and the BillingPage).
//   3. Looks up `plan.feature_flags[flag]`. Truthy → call `next()`.
//      Falsey or missing → respond 402 with a machine-readable
//      `feature_not_in_plan` payload that the admin frontend humanizes
//      into an `UpgradePrompt`.
//
// The 402 body includes `current_plan`, `flag`, and `upgrade_to` (the
// cheapest plan that DOES include the flag, computed from the live
// `pricing_plans` catalog) so the UI can deep-link straight to the
// right Stripe checkout.
//
// Hot-path note: the per-request DB reads (1 project + 1 subscription)
// are dominated by Postgres connection cost. We skip the cache here on
// purpose — these endpoints are write-heavy and infrequent (SSO config
// is set once per tenant), and stale entitlement decisions during a
// plan upgrade are user-visible. `quota.ts` caches because it sits on
// the report-ingest hot path.
// ============================================================
import type { Context, Next } from 'npm:hono@4'
import { getServiceClient } from './db.ts'
import { getPlan, listPlans, resolvePlanFromSubscription, type PricingPlan } from './plans.ts'
import { log } from './logger.ts'

export type FeatureFlag =
  | 'sso'
  | 'byok'
  | 'plugins'
  | 'intelligence_reports'
  | 'audit_log'
  | 'soc2'
  | 'self_hosted'
  | 'teams'

export interface ResolvedEntitlement {
  projectId: string
  organizationId: string | null
  plan: PricingPlan
  /** true when `plan.feature_flags[flag]` is the literal boolean `true`. */
  hasFeature: (flag: FeatureFlag) => boolean
}

/**
 * Resolve the caller's active project + plan in one round trip.
 *
 * Reads `userId` (always set by `jwtAuth` / `adminOrApiKey`) and
 * optionally `projectId` (set by `adminOrApiKey` when the caller used
 * an API key) from the Hono context. JWT callers fall through to the
 * `owner_id` projection — same query every gated handler already runs,
 * just centralised so we don't drift.
 *
 * Returns `null` when the caller has no project at all (fresh signup
 * with no project provisioned yet). Callers translate that to a domain
 * 404 (`NO_PROJECT`) rather than a 402 — there's nothing to upgrade.
 */
export async function resolveActiveEntitlement(
  c: Context,
): Promise<ResolvedEntitlement | null> {
  const userId = c.get('userId') as string | undefined
  if (!userId) return null

  const db = getServiceClient()
  let projectId = c.get('projectId') as string | undefined
  let organizationId = c.get('organizationId') as string | undefined

  if (!projectId) {
    const { data: memberships } = await db
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)

    const orgIds = (memberships ?? []).map((m) => m.organization_id).filter(Boolean)
    let projectQuery = db.from('projects').select('id, organization_id').limit(1)
    if (orgIds.length > 0) {
      projectQuery = projectQuery.in('organization_id', orgIds)
    } else {
      projectQuery = projectQuery.eq('owner_id', userId)
    }
    const { data: project } = await projectQuery.single()
    if (!project) return null
    projectId = project.id as string
    organizationId = (project.organization_id as string | null) ?? undefined
  }

  if (!organizationId) {
    const { data: project } = await db
      .from('projects')
      .select('organization_id')
      .eq('id', projectId)
      .maybeSingle()
    organizationId = (project?.organization_id as string | null) ?? undefined
  }

  const { data: org } = organizationId
    ? await db.from('organizations').select('plan_id').eq('id', organizationId).maybeSingle()
    : { data: null }

  const { data: sub } = organizationId
    ? await db
        .from('billing_subscriptions')
        .select('status, plan_id')
        .eq('organization_id', organizationId)
        .in('status', ['active', 'trialing', 'past_due'])
        .order('current_period_end', { ascending: false })
        .limit(1)
        .maybeSingle()
    : await db
        .from('billing_subscriptions')
        .select('status, plan_id')
        .eq('project_id', projectId)
        .in('status', ['active', 'trialing', 'past_due'])
        .order('current_period_end', { ascending: false })
        .limit(1)
        .maybeSingle()

  const plan = sub ? await resolvePlanFromSubscription(sub) : await getPlan(org?.plan_id ?? 'hobby')

  return {
    projectId,
    organizationId: organizationId ?? null,
    plan,
    hasFeature: (flag) => plan.feature_flags?.[flag] === true,
  }
}

/**
 * Return the cheapest plan whose `feature_flags[flag] === true`. Used
 * to populate the `upgrade_to` hint in the 402 body so the UI can
 * deep-link to the right checkout. Returns `null` when no plan in the
 * catalog includes the flag (defensive — every catalogued flag should
 * have at least one plan that grants it).
 */
export async function minimumPlanFor(flag: FeatureFlag): Promise<PricingPlan | null> {
  const plans = await listPlans()
  for (const plan of plans) {
    if (plan.feature_flags?.[flag] === true) return plan
  }
  return null
}

interface EntitlementErrorBody {
  ok: false
  error: {
    code: 'feature_not_in_plan' | 'NO_PROJECT'
    message: string
    flag?: FeatureFlag
    current_plan?: string
    upgrade_to?: {
      id: string
      display_name: string
      monthly_price_usd: number
    } | null
  }
}

/**
 * Hono middleware factory: gate a route on a plan-level feature flag.
 *
 * Usage:
 *   app.post('/v1/admin/sso', jwtAuth, requireFeature('sso'), async (c) => { ... })
 *
 * Must be applied AFTER `jwtAuth` / `adminOrApiKey` so `userId` (and
 * optionally `projectId`) are populated. The middleware sets two
 * context slots so the wrapped handler can reuse the resolved values
 * without re-querying:
 *   - `c.get('entitlement')` → ResolvedEntitlement
 *   - `c.get('projectId')`   → resolved project id (already set when
 *                              caller used an API key)
 */
export function requireFeature(flag: FeatureFlag) {
  return async function middleware(c: Context, next: Next) {
    const entitlement = await resolveActiveEntitlement(c)

    if (!entitlement) {
      const body: EntitlementErrorBody = {
        ok: false,
        error: {
          code: 'NO_PROJECT',
          message: 'No project found for the authenticated user.',
        },
      }
      return c.json(body, 404)
    }

    if (entitlement.hasFeature(flag)) {
      c.set('entitlement', entitlement)
      c.set('projectId', entitlement.projectId)
      await next()
      return
    }

    const upgradePlan = await minimumPlanFor(flag)
    log.info('entitlement_blocked', {
      path: c.req.path,
      method: c.req.method,
      flag,
      current_plan: entitlement.plan.id,
      upgrade_to: upgradePlan?.id ?? null,
    })

    const body: EntitlementErrorBody = {
      ok: false,
      error: {
        code: 'feature_not_in_plan',
        message:
          `This endpoint requires a plan that includes "${flag}". ` +
          `Your current plan is "${entitlement.plan.display_name}". ` +
          (upgradePlan
            ? `Upgrade to ${upgradePlan.display_name} or higher to enable it.`
            : 'Contact support to enable this feature.'),
        flag,
        current_plan: entitlement.plan.id,
        upgrade_to: upgradePlan
          ? {
              id: upgradePlan.id,
              display_name: upgradePlan.display_name,
              monthly_price_usd: upgradePlan.monthly_price_usd,
            }
          : null,
      },
    }
    return c.json(body, 402)
  }
}

/**
 * Map a route prefix to the feature flag that gates it. Exported so
 * the `/v1/admin/entitlements` introspection endpoint and the unit
 * test matrix stay in sync without each side hand-rolling its own
 * mapping.
 */
export const GATED_ROUTES: ReadonlyArray<{
  prefix: string
  flag: FeatureFlag
}> = [
  { prefix: '/v1/admin/sso', flag: 'sso' },
  { prefix: '/v1/admin/byok', flag: 'byok' },
  { prefix: '/v1/admin/plugins', flag: 'plugins' },
  { prefix: '/v1/admin/intelligence', flag: 'intelligence_reports' },
  { prefix: '/v1/org', flag: 'teams' },
]
