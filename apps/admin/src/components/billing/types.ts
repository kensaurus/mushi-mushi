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
