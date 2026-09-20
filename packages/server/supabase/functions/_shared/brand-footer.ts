/**
 * FILE: packages/server/supabase/functions/_shared/brand-footer.ts
 * PURPOSE: Plan-based default for the "Bug reports by Mushi" widget footer
 *          (growth loop, docs/plan-gtm.md → Workstream C §6).
 *
 *   project_settings.widget_brand_footer (20260921000006) wins when set.
 *   Otherwise: on for free_cloud / hobby, off for every paid plan. Self-host
 *   deployments run paid/enterprise plan rows (or the host's MIT
 *   `brandFooter` config, which is a hard override on the client), so they
 *   land on "off" without a separate switch.
 *
 * Resolution mirrors _shared/entitlements.ts resolveActiveEntitlement()
 * (billing_subscriptions → organizations.plan_id → free_cloud) but takes a
 * project id instead of the Hono context, so the admin sdk-config routes
 * (which take :id) and the SDK runtime route share it.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getPlan, resolvePlanFromSubscription } from './plans.ts'
import { log } from './logger.ts'

const FREE_PLAN_IDS: ReadonlySet<string> = new Set(['free_cloud', 'hobby'])

/** Pure: true for the free cloud tiers, false for anything paid. */
export function brandFooterDefaultForPlan(planId: string | null | undefined): boolean {
  return FREE_PLAN_IDS.has(planId ?? 'free_cloud')
}

/**
 * Plan-derived default for one project. Fails closed to `false` on any
 * lookup error: a transient DB hiccup must never surface the footer on a
 * paying customer's widget.
 */
export async function brandFooterDefaultForProject(db: SupabaseClient, projectId: string): Promise<boolean> {
  try {
    const { data: project } = await db
      .from('projects')
      .select('organization_id')
      .eq('id', projectId)
      .maybeSingle()
    const orgId = (project?.organization_id as string | null | undefined) ?? null

    const subQuery = orgId
      ? db.from('billing_subscriptions').select('status, plan_id').eq('organization_id', orgId)
      : db.from('billing_subscriptions').select('status, plan_id').eq('project_id', projectId)
    const { data: sub } = await subQuery
      .in('status', ['active', 'trialing', 'past_due'])
      .order('current_period_end', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (sub) {
      const plan = await resolvePlanFromSubscription(sub as { status?: string | null; plan_id?: string | null })
      return brandFooterDefaultForPlan(plan.id)
    }

    const { data: org } = orgId
      ? await db.from('organizations').select('plan_id').eq('id', orgId).maybeSingle()
      : { data: null }
    const plan = await getPlan(((org as { plan_id?: string | null } | null)?.plan_id) ?? 'free_cloud')
    return brandFooterDefaultForPlan(plan.id)
  } catch (err) {
    log.warn('brand-footer: plan lookup failed, defaulting to off', {
      projectId,
      err: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
