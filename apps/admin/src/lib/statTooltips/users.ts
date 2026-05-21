/**
 * FILE: apps/admin/src/lib/statTooltips/users.ts
 * PURPOSE: Human-readable StatCard tooltips for the Users operator metrics strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import { metricTip } from '../metricTooltipBuilder'

export interface UsersMetrics {
  total_users: number
  paid_users: number
  mrr_usd: number
  signups_last_7d: number
  signups_last_30d: number
  churn_last_30d: number
}

export function totalSignupsTooltip(metrics: UsersMetrics | null | undefined): MetricTooltipData {
  const total = metrics?.total_users ?? 0
  const takeaway =
    total > 0
      ? `${total.toLocaleString()} Mushi account${total === 1 ? '' : 's'} registered platform-wide.`
      : 'No signups recorded yet — metrics populate after the first user registers.'

  return metricTip(
    'Total registered Mushi accounts across the entire platform (super-admin view).',
    'GET /v1/super-admin/users metrics — counts auth.users / platform signups all-time.',
    takeaway,
  )
}

export function totalSignupsDetail(): string {
  return 'All-time platform signups'
}

export function paidUsersTooltip(metrics: UsersMetrics | null | undefined): MetricTooltipData {
  const paid = metrics?.paid_users ?? 0
  const total = metrics?.total_users ?? 0
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0
  const takeaway =
    paid > 0
      ? `${paid} paid subscriber${paid === 1 ? '' : 's'} of ${total.toLocaleString()} total (${pct}% conversion).`
      : 'No paid subscribers yet — all accounts on free/hobby tiers.'

  return metricTip(
    'Accounts on a paid plan tier (Pro or above) with active billing.',
    'Counts users with entitlements or subscription_tier indicating paid status from billing sync.',
    takeaway,
  )
}

export function paidUsersDetail(metrics: UsersMetrics | null | undefined): string {
  const paid = metrics?.paid_users ?? 0
  return paid > 0 ? 'Paid plan tier' : 'No paid users'
}

export function mrrTooltip(metrics: UsersMetrics | null | undefined): MetricTooltipData {
  const mrr = metrics?.mrr_usd ?? 0
  const takeaway =
    mrr > 0
      ? `$${mrr.toLocaleString()} monthly recurring revenue (USD) from active subscriptions.`
      : 'Zero MRR — no active paid subscriptions billing this month.'

  return metricTip(
    'Monthly recurring revenue in USD from active paid subscriptions.',
    'Sum of normalized monthly subscription amounts from Stripe/RevenueCat billing sync (USD).',
    takeaway,
  )
}

export function mrrDetail(): string {
  return 'USD · active subs'
}

export function signups7dTooltip(metrics: UsersMetrics | null | undefined): MetricTooltipData {
  const count = metrics?.signups_last_7d ?? 0
  const takeaway =
    count > 0
      ? `${count} new signup${count === 1 ? '' : 's'} in the last 7 days — compare with 30d trend below.`
      : 'No signups in the last 7 days — acquisition may be quiet or tracking lag.'

  return metricTip(
    'New account registrations in the rolling last 7 days (UTC).',
    'Counts users where signed_up_at falls within the last 7 days.',
    takeaway,
  )
}

export function signups7dDetail(): string {
  return 'Rolling 7 days'
}

export function signups30dTooltip(metrics: UsersMetrics | null | undefined): MetricTooltipData {
  const count = metrics?.signups_last_30d ?? 0
  const count7 = metrics?.signups_last_7d ?? 0
  const takeaway =
    count > 0
      ? `${count} signup${count === 1 ? '' : 's'} in 30d (${count7} in the last 7d).`
      : 'No signups in the last 30 days.'

  return metricTip(
    'New account registrations in the rolling last 30 days (UTC).',
    'Counts users where signed_up_at falls within the last 30 days.',
    takeaway,
  )
}

export function signups30dDetail(metrics: UsersMetrics | null | undefined): string {
  const count7 = metrics?.signups_last_7d ?? 0
  return count7 > 0 ? `${count7} in last 7d` : 'Rolling 30 days'
}

export function churn30dTooltip(metrics: UsersMetrics | null | undefined): MetricTooltipData {
  const churn = metrics?.churn_last_30d ?? 0
  const takeaway =
    churn > 0
      ? `${churn} paid account${churn === 1 ? '' : 's'} churned in the last 30 days — review cancellation reasons in billing.`
      : 'Zero churn in 30d — no paid cancellations recorded.'

  return metricTip(
    'Paid accounts that cancelled or downgraded to free in the last 30 days.',
    'Counts subscription cancellations or tier downgrades with effective_at in the last 30 days.',
    takeaway,
    churn > 0
      ? { tone: 'warn', text: `${churn} churn event${churn === 1 ? '' : 's'} in 30d — check Billing for details.` }
      : undefined,
  )
}

export function churn30dDetail(): string {
  return 'Paid cancellations · 30d'
}
