/**
 * FILE: apps/admin/src/components/billing/types.ts
 */

export type BillingTabId = 'overview' | 'plans' | 'support'

export interface BillingStats {
  projectId: string | null
  projectName: string | null
  organizationId: string | null
  billingMode: 'stripe' | 'complimentary' | null
  planId: string
  planDisplayName: string
  subscriptionStatus: string | null
  isComplimentary: boolean
  hasStripeCustomer: boolean
  paymentOk: boolean
  cancelAtPeriodEnd: boolean
  reportsUsed: number
  reportsLimit: number | null
  usagePct: number | null
  overQuota: boolean
  approachingQuota: boolean
  /** Phase 2: diagnoses metering — null when the plan doesn't have a diagnoses limit. */
  diagnosesUsed?: number | null
  diagnosesLimit?: number | null
  diagnosesUsagePct?: number | null
  overDiagnosisQuota?: boolean
  approachingDiagnosisQuota?: boolean
  fixesAttempted: number
  fixesSucceeded: number
  llmCostUsdMonth: number
  /** Hard monthly spend cap in USD — when set, replaces LLM COGS tile in snapshot. */
  monthlySpendCapUsd?: number | null
  periodEnd: string | null
  projectCount: number
  freeLimitReports: number
  pastDueProjects: number
  unpaidProjects: number
}

export const EMPTY_BILLING_STATS: BillingStats = {
  projectId: null,
  projectName: null,
  organizationId: null,
  billingMode: null,
  planId: 'hobby',
  planDisplayName: 'Hobby',
  subscriptionStatus: null,
  isComplimentary: false,
  hasStripeCustomer: false,
  paymentOk: false,
  cancelAtPeriodEnd: false,
  reportsUsed: 0,
  reportsLimit: null,
  usagePct: null,
  overQuota: false,
  approachingQuota: false,
  fixesAttempted: 0,
  fixesSucceeded: 0,
  llmCostUsdMonth: 0,
  periodEnd: null,
  projectCount: 0,
  freeLimitReports: 1000,
  pastDueProjects: 0,
  unpaidProjects: 0,
}

export interface PlanCatalog {
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

export interface ProjectTier {
  id: string
  display_name: string
  monthly_price_usd: number
  included_reports_per_month: number | null
  overage_unit_amount_decimal: number | null
  included_diagnoses_per_month?: number | null
  overage_unit_amount_decimal_diagnoses?: number | null
  monthly_spend_cap_usd?: number | null
  retention_days: number
  feature_flags: Record<string, unknown>
}

export interface BillingProject {
  project_id: string
  project_name: string
  plan: string
  tier?: ProjectTier
  subscription: {
    status?: string
    plan_id?: string | null
    stripe_price_id?: string | null
    current_period_start?: string
    current_period_end?: string
    cancel_at_period_end?: boolean
    synthetic?: boolean
  } | null
  customer: {
    stripe_customer_id?: string
    default_payment_ok?: boolean
    email?: string | null
  } | null
  billing_mode?: 'stripe' | 'complimentary'
  period_start: string
  usage: {
    reports: number
    fixes: number
    fixesSucceeded?: number
    tokens: number
  }
  llm_cost_usd_this_month?: number
  limit_reports: number | null
  over_quota: boolean
  usage_pct?: number | null
  diagnoses_used?: number | null
  limit_diagnoses?: number | null
  diagnoses_usage_pct?: number | null
  over_diagnosis_quota?: boolean
  spend_cap_usd?: number | null
  alert_email?: string | null
  usage_series?: {
    days: Array<{ day: string; reports: number }>
  } | null
}

export interface BillingResponse {
  projects: BillingProject[]
  plans?: PlanCatalog[]
  free_limit_reports_per_month: number
}

export interface Invoice {
  id: string
  number: string | null
  status: string
  amount_due: number
  amount_paid: number
  currency: string
  created: number
  hosted_invoice_url: string | null
  invoice_pdf: string | null
  period_start: number
  period_end: number
}

export interface SupportInfo {
  email: string
  url: string
  operator_notifications_enabled: boolean
}

export interface SupportTicket {
  id: string
  project_id: string | null
  subject: string
  body?: string
  category: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed' | 'cancelled'
  plan_id: string | null
  admin_response?: string | null
  admin_responded_at?: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  cancelled_at?: string | null
}

