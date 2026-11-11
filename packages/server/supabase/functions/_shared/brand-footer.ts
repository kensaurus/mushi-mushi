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
 * The plan is the project's team plan (_shared/org-billing.ts, the same
 * resolver as every other plan gate), so one paid subscription removes the
 * mark from every app in the team. Takes a project id, so the admin
 * sdk-config routes (which take :id) and the SDK runtime route share it.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { resolveProjectBilling } from './org-billing.ts'
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
    const { plan } = await resolveProjectBilling(db, projectId)
    return brandFooterDefaultForPlan(plan.id)
  } catch (err) {
    log.warn('brand-footer: plan lookup failed, defaulting to off', {
      projectId,
      err: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
