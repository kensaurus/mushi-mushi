/**
 * FILE: packages/server/supabase/functions/_shared/retention-policy.ts
 * PURPOSE: The one place that decides how long a project's reports are kept.
 *
 * Two callers must agree, or the console lies about what the sweep deletes:
 *   - retention-sweep/index.ts  — deletes reports older than the window.
 *   - api/routes/admin-ops.ts   — GET /v1/admin/retention-status, which shows
 *                                 the owner that window and what expires next.
 *
 * Precedence (same as _shared/entitlements.ts for plan resolution):
 *   1. project_retention_policies: legal_hold, then reports_retention_days.
 *   2. A live billing subscription, keyed on the organization (or on the
 *      project for rows that predate organizations).
 *   3. organizations.plan_id.
 *   4. The free fallback.
 *
 * Step 3 was missing until 2026-09-21. The founder's org is on `pro` (90 days)
 * with no Stripe row, so every dogfood project fell through to the 7-day free
 * window and the daily sweep deleted real end-user reports.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getPlan, resolvePlanFromSubscription } from './plans.ts'

/** Used only when a plan row has no retention_days at all. */
export const FALLBACK_RETENTION_DAYS = 7

export type RetentionSource = 'override' | 'plan' | 'fallback'

export interface ProjectRetention {
  retention_days: number
  plan_id: string
  source: RetentionSource
  legal_hold: boolean
}

interface RetentionPolicyRow {
  reports_retention_days: number | null
  legal_hold: boolean
}

interface SubscriptionRow {
  status: string
  plan_id: string | null
}

export async function resolveProjectRetention(
  db: SupabaseClient,
  projectId: string,
): Promise<ProjectRetention> {
  const { data: policy } = await db
    .from('project_retention_policies')
    .select('reports_retention_days, legal_hold')
    .eq('project_id', projectId)
    .maybeSingle<RetentionPolicyRow>()

  if (policy?.legal_hold) {
    return {
      retention_days: policy.reports_retention_days ?? FALLBACK_RETENTION_DAYS,
      plan_id: 'legal_hold',
      source: 'override',
      legal_hold: true,
    }
  }
  if (policy?.reports_retention_days) {
    return {
      retention_days: policy.reports_retention_days,
      plan_id: 'override',
      source: 'override',
      legal_hold: false,
    }
  }

  const { data: project } = await db
    .from('projects')
    .select('organization_id')
    .eq('id', projectId)
    .maybeSingle<{ organization_id: string | null }>()
  const organizationId = project?.organization_id ?? null

  const subscriptionQuery = db
    .from('billing_subscriptions')
    .select('status, plan_id')
    .in('status', ['active', 'trialing', 'past_due'])
    .order('current_period_end', { ascending: false })
    .limit(1)
  const { data: sub } = await (organizationId
    ? subscriptionQuery.eq('organization_id', organizationId)
    : subscriptionQuery.eq('project_id', projectId)
  ).maybeSingle<SubscriptionRow>()

  if (sub) {
    const plan = await resolvePlanFromSubscription(sub)
    return {
      retention_days: plan.retention_days ?? FALLBACK_RETENTION_DAYS,
      plan_id: plan.id,
      source: 'plan',
      legal_hold: false,
    }
  }

  const { data: org } = organizationId
    ? await db
        .from('organizations')
        .select('plan_id')
        .eq('id', organizationId)
        .maybeSingle<{ plan_id: string | null }>()
    : { data: null }

  if (org?.plan_id) {
    const plan = await getPlan(org.plan_id)
    return {
      retention_days: plan.retention_days ?? FALLBACK_RETENTION_DAYS,
      plan_id: plan.id,
      source: 'plan',
      legal_hold: false,
    }
  }

  const plan = await resolvePlanFromSubscription(null)
  return {
    retention_days: plan.retention_days ?? FALLBACK_RETENTION_DAYS,
    plan_id: plan.id,
    source: 'fallback',
    legal_hold: false,
  }
}
