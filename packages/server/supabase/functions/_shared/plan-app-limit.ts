/**
 * FILE: packages/server/supabase/functions/_shared/plan-app-limit.ts
 * PURPOSE: How many apps an organization may create on its plan
 *          (docs/plan-pricing.md, 2026-10-28: apps watched is the value
 *          metric; Free 1, Builder 3, Studio 10, Enterprise no limit).
 *          Pure, so the route and its tests share one rule.
 */

export interface AppLimitPlan {
  id: string
  display_name: string
  max_projects?: number | null
}

export interface AppLimitDenial {
  code: 'PLAN_APP_LIMIT'
  message: string
  limit: number
  used: number
  upgradeTo: 'indie' | 'pro' | 'enterprise'
}

/** The plan to suggest when an organization is out of apps. */
function nextPlan(planId: string): AppLimitDenial['upgradeTo'] {
  if (planId === 'indie') return 'pro'
  if (planId === 'pro') return 'enterprise'
  return 'indie'
}

const UPGRADE_NAME: Record<AppLimitDenial['upgradeTo'], string> = {
  indie: 'Builder (3 apps)',
  pro: 'Studio (10 apps)',
  enterprise: 'Enterprise',
}

/**
 * Null when one more app fits. A plan with no `max_projects` has no limit;
 * existing apps are never touched, only a new one is refused.
 */
export function appLimitDenial(plan: AppLimitPlan, appsInOrganization: number): AppLimitDenial | null {
  const limit = plan.max_projects
  if (limit === null || limit === undefined) return null
  if (appsInOrganization < limit) return null
  const upgradeTo = nextPlan(plan.id)
  return {
    code: 'PLAN_APP_LIMIT',
    message: `${plan.display_name} watches ${limit} app${limit === 1 ? '' : 's'}, and this team has ${appsInOrganization}. Move to ${UPGRADE_NAME[upgradeTo]} to add another, or remove an app you no longer use.`,
    limit,
    used: appsInOrganization,
    upgradeTo,
  }
}
