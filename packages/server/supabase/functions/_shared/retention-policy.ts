/**
 * FILE: packages/server/supabase/functions/_shared/retention-policy.ts
 * PURPOSE: The one place that decides how long a project's reports are kept.
 *
 * Two callers must agree, or the console lies about what the sweep deletes:
 *   - retention-sweep/index.ts  — deletes reports older than the window.
 *   - api/routes/admin-ops.ts   — GET /v1/admin/retention-status, which shows
 *                                 the owner that window and what expires next.
 *
 * Precedence:
 *   1. project_retention_policies: legal_hold, then reports_retention_days.
 *   2. The team's plan from _shared/org-billing.ts (the resolver every plan
 *      gate shares): a live subscription on the organization, else
 *      organizations.plan_id, else the free fallback.
 *
 * Step 3 was missing until 2026-09-21. The founder's org is on `pro` (90 days)
 * with no Stripe row, so every dogfood project fell through to the 7-day free
 * window and the daily sweep deleted real end-user reports.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { resolveProjectBilling } from './org-billing.ts'

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

  // The team's plan (org-billing.ts: complimentary org → its plan; else the
  // org's live subscription; else organizations.plan_id; else Free). A read
  // error throws: the sweep must never delete on a guessed short window.
  const billing = await resolveProjectBilling(db, projectId)
  const fromPlan = billing.liveSub !== null || billing.orgPlanId !== null
  return {
    retention_days: billing.plan.retention_days ?? FALLBACK_RETENTION_DAYS,
    plan_id: billing.plan.id,
    source: fromPlan ? 'plan' : 'fallback',
    legal_hold: false,
  }
}
