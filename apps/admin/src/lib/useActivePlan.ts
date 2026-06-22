/**
 * FILE: apps/admin/src/lib/useActivePlan.ts
 * PURPOSE: Read the active project's current plan (tier + limits + feature
 *          flags) from the already-cached `/v1/admin/billing` payload so the
 *          header badge, sidebar pill, and future plan-aware surfaces all
 *          agree on one shape. Pairs with `useActiveProjectId()` from
 *          `ProjectSwitcher` so switching projects updates the badge instantly.
 *
 *          Zero extra network cost: `apiFetch`'s in-flight dedup + 200ms
 *          micro-cache means opening Billing + Dashboard in the same session
 *          shares one request.
 */

import { useMemo } from 'react'
import { usePageData } from './usePageData'
import { useActiveProjectId } from '../components/ProjectSwitcher'

export type PlanId = 'hobby' | 'starter' | 'pro' | 'enterprise' | (string & {})

export interface PlanFeatureFlags {
  sso?: boolean
  byok?: boolean
  plugins?: boolean
  audit_log?: boolean
  intelligence_reports?: boolean
  soc2?: boolean
  self_hosted?: boolean
  teams?: boolean
  sla_hours?: number | null
}

export interface ActivePlanSummary {
  /** `hobby` | `starter` | `pro` | `enterprise`. Always present. */
  planId: PlanId
  /** Human-readable plan name from the catalog. */
  displayName: string
  monthlyPriceUsd: number
  includedReportsPerMonth: number | null
  overageUnitAmountDecimal: number | null
  retentionDays: number
  seatLimit: number | null
  featureFlags: PlanFeatureFlags
  /** Usage this period. */
  reportsUsed: number
  /** 0–100 or null when limit is unlimited. */
  usagePct: number | null
  /** Phase 2 diagnoses metering fields — null when plan uses reports-only metering. */
  diagnosesUsed?: number | null
  diagnosesLimit?: number | null
  diagnosesUsagePct?: number | null
  /** Stripe subscription status when applicable. */
  subscriptionStatus: string | null
  cancelAtPeriodEnd: boolean
  /** Quick flag consumers can pass to `PlanBadge` without parsing `planId`. */
  isPaid: boolean
  /** `true` when the project is blocked from ingesting new reports. */
  overQuota: boolean
  /**
   * Org-level billing posture inherited from `organizations.billing_mode`.
   * `'stripe'` (default) = self-serve, paying customer.
   * `'complimentary'` = Mushi-internal staff / sponsored / beta — entitlements
   * track `planId` but no Stripe customer or invoice exists. The PlanBadge,
   * OrgSwitcher, and BillingPage all render an "Admin" affordance instead of
   * the plain tier label so the user understands they're not a paying Pro.
   */
  billingMode: 'stripe' | 'complimentary'
  /** Convenience flag — equivalent to `billingMode === 'complimentary'`. */
  isComplimentary: boolean
}

interface BillingProject {
  project_id: string
  project_name: string
  plan: string
  tier?: {
    id: string
    display_name: string
    monthly_price_usd: number
    included_reports_per_month: number | null
    overage_unit_amount_decimal: number | null
    retention_days: number
    seat_limit?: number | null
    feature_flags: Record<string, unknown>
  }
  subscription: { status?: string; cancel_at_period_end?: boolean } | null
  usage: { reports: number }
  limit_reports: number | null
  over_quota: boolean
  usage_pct?: number | null
  billing_mode?: 'stripe' | 'complimentary'
  /** Phase 2 diagnoses metering fields. */
  diagnoses_used?: number | null
  limit_diagnoses?: number | null
  diagnoses_usage_pct?: number | null
}

interface BillingResponse {
  projects: BillingProject[]
}

const PAID_PLAN_IDS = new Set(['starter', 'pro', 'enterprise'])

export interface UseActivePlanResult {
  plan: ActivePlanSummary | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useActivePlan(): UseActivePlanResult {
  const activeProjectId = useActiveProjectId()
  const { data, loading, error, reload } = usePageData<BillingResponse>('/v1/admin/billing')

  const plan = useMemo<ActivePlanSummary | null>(() => {
    const projects = data?.projects ?? []
    if (projects.length === 0) return null
    const project = activeProjectId
      ? projects.find(p => p.project_id === activeProjectId) ?? projects[0]
      : projects[0]
    const tier = project.tier
    if (!tier) return null
    const flags = (tier.feature_flags ?? {}) as PlanFeatureFlags
    const billingMode = project.billing_mode === 'complimentary' ? 'complimentary' : 'stripe'
    return {
      planId: tier.id as PlanId,
      displayName: tier.display_name,
      monthlyPriceUsd: Number(tier.monthly_price_usd ?? 0),
      includedReportsPerMonth: tier.included_reports_per_month,
      overageUnitAmountDecimal:
        tier.overage_unit_amount_decimal != null ? Number(tier.overage_unit_amount_decimal) : null,
      retentionDays: tier.retention_days,
      seatLimit: tier.seat_limit ?? null,
      featureFlags: flags,
      reportsUsed: project.usage?.reports ?? 0,
      usagePct: project.limit_diagnoses != null
        ? (project.diagnoses_usage_pct ?? null)
        : (project.usage_pct ?? null),
      diagnosesUsed: project.diagnoses_used ?? null,
      diagnosesLimit: project.limit_diagnoses ?? null,
      diagnosesUsagePct: project.diagnoses_usage_pct ?? null,
      subscriptionStatus: project.subscription?.status ?? null,
      cancelAtPeriodEnd: Boolean(project.subscription?.cancel_at_period_end),
      // Complimentary orgs aren't paying customers even on `pro` — `isPaid`
      // stays gated on actual revenue so paywall/CTA logic doesn't accidentally
      // start prompting Mushi staff to "upgrade" their own comp account.
      isPaid: PAID_PLAN_IDS.has(tier.id) && billingMode !== 'complimentary',
      overQuota: Boolean(project.over_quota),
      billingMode,
      isComplimentary: billingMode === 'complimentary',
    }
  }, [data, activeProjectId])

  return { plan, loading, error, reload }
}
