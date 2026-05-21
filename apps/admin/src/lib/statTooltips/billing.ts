/**
 * FILE: apps/admin/src/lib/statTooltips/billing.ts
 * PURPOSE: Human-readable StatCard tooltips for the Billing snapshot strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { BillingStats } from '../../components/billing/types'
import { metricTip } from '../metricTooltipBuilder'

export function planTooltip(stats: BillingStats): MetricTooltipData {
  const statusLine = stats.isComplimentary
    ? 'This project is on a complimentary admin account — no Stripe subscription required.'
    : stats.subscriptionStatus
      ? `Stripe subscription status: ${stats.subscriptionStatus}.${stats.cancelAtPeriodEnd ? ' Cancels at period end.' : ''}`
      : 'No active Stripe subscription — the project is on the default Hobby tier.'

  return metricTip(
    `Current billing plan for the active project — ${stats.planDisplayName}.`,
    'Reads organizations.plan_id and billing_subscriptions for the active project. Complimentary orgs override Stripe; otherwise plan_id maps to the catalog display name.',
    statusLine,
    !stats.paymentOk && stats.hasStripeCustomer && !stats.isComplimentary
      ? { tone: 'warn', text: 'Payment method may need attention — open Manage billing to fix card or invoice issues.' }
      : stats.isComplimentary
        ? { tone: 'info', text: 'Complimentary admin account — usage limits still apply.' }
        : undefined,
  )
}

export function planDetail(stats: BillingStats): string {
  return stats.isComplimentary
    ? 'Complimentary admin account'
    : stats.subscriptionStatus ?? 'No subscription'
}

export function reportsPeriodTooltip(stats: BillingStats): MetricTooltipData {
  const limitLine =
    stats.reportsLimit != null
      ? `${stats.reportsUsed.toLocaleString()} of ${stats.reportsLimit.toLocaleString()} included reports consumed this UTC billing month (${stats.usagePct ?? 0}%).`
      : `${stats.reportsUsed.toLocaleString()} reports logged this month — unlimited on this tier.`

  return metricTip(
    'Bug-report intake counted against the current billing period quota.',
    'Sums usage_events where event_name is report.ingested since the first day of the current UTC month for the active project. Limit comes from the plan catalog (null = unlimited).',
    limitLine,
    stats.overQuota
      ? { tone: 'warn', text: 'Over monthly report quota — upgrade or wait for the next period reset.' }
      : stats.approachingQuota
        ? { tone: 'info', text: 'Approaching monthly quota — monitor intake before overage.' }
        : undefined,
  )
}

export function reportsPeriodDetail(stats: BillingStats): string {
  return stats.usagePct != null ? `${stats.usagePct}% of monthly quota` : 'Unlimited on this tier'
}

export function fixesPeriodTooltip(stats: BillingStats): MetricTooltipData {
  const rate =
    stats.fixesAttempted > 0
      ? `${stats.fixesSucceeded} of ${stats.fixesAttempted} autofix runs succeeded (${Math.round((stats.fixesSucceeded / stats.fixesAttempted) * 100)}%).`
      : 'No autofix attempts this billing period yet.'

  return metricTip(
    'Autofix success vs attempts in the current UTC billing month.',
    'Counts fix_attempts rows created since month start for the active project. Succeeded = status completed; attempted = all non-cancelled runs in the window.',
    rate,
    stats.fixesAttempted > 0 && stats.fixesSucceeded < stats.fixesAttempted
      ? {
          tone: 'warn',
          text: `${stats.fixesAttempted - stats.fixesSucceeded} failed fix${stats.fixesAttempted - stats.fixesSucceeded === 1 ? '' : 'es'} this period — inspect Fixes before retrying.`,
        }
      : undefined,
  )
}

export function fixesPeriodDetail(): string {
  return 'Succeeded / attempted autofix runs'
}

export function llmCogsTooltip(stats: BillingStats): MetricTooltipData {
  const cost =
    stats.llmCostUsdMonth > 0
      ? `$${stats.llmCostUsdMonth.toFixed(2)} in LLM cost logged this UTC month.`
      : 'Zero LLM cost this month — agents only log spend when they call a model.'

  return metricTip(
    'Estimated LLM cost of goods sold (COGS) for the active project this UTC calendar month.',
    'Sums llm_invocations.cost_usd where created_at is on or after the first of the month (UTC). Token-based estimates fill in when cost_usd is null.',
    `${cost} Open LLM Cost for operation/model breakdown; this strip is the billing-period rollup.`,
    stats.periodEnd
      ? {
          tone: 'info',
          text: `Billing period ends ${new Date(stats.periodEnd).toLocaleDateString()} — pair with LLM Cost for daily burn.`,
        }
      : undefined,
  )
}

export function llmCogsDetail(stats: BillingStats): string {
  return stats.periodEnd
    ? 'Period ends soon — see LLM Cost for detail'
    : 'Summed from llm_invocations.cost_usd'
}
