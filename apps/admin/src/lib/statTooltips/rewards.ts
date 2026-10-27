/**
 * FILE: apps/admin/src/lib/statTooltips/rewards.ts
 * PURPOSE: Human-readable StatCard tooltips for the Rewards console.
 */

import type { MetricTooltipData } from '../../components/ui'
import { metricTip } from '../metricTooltipBuilder'

/** Overview tab KPI strip (uses overview API payload). */
export function overviewContributorsTooltip(count: number): MetricTooltipData {
  return metricTip(
    'Distinct users who earned at least one point in the last 30 days.',
    'Same as Contributors · 30d on the snapshot — unique end_user_id on positive point deltas.',
    count > 0
      ? `${count} active contributor${count === 1 ? '' : 's'} — drill into Contributors tab for per-user ledgers.`
      : 'Zero means no qualifying activity reached the points ledger yet.',
  )
}

export function overviewContributorsDetail(): string {
  return 'Distinct users who earned at least 1 point in the last 30 days.'
}

export function overviewPointsTooltip(points: number): MetricTooltipData {
  return metricTip(
    'Total points credited across all users in the last 30 days.',
    'Sum of positive end_user_points deltas in the rolling 30-day window.',
    `${points.toLocaleString()} points awarded — compare to Rules to see which actions drive the most credit.`,
  )
}

export function overviewPointsDetail(): string {
  return 'Total points credited to all users in the last 30 days.'
}

export function overviewTierHoldersTooltip(total: number): MetricTooltipData {
  return metricTip(
    'Users who crossed a tier threshold and hold a non-free rank on the ladder.',
    'Derived from tier_distribution on the overview API — counts users bucketed above the base/free tier.',
    total > 0
      ? `${total} tier holder${total === 1 ? '' : 's'} — open Tiers tab to adjust thresholds or add rungs.`
      : 'Everyone is still on the base tier — lower the first threshold or increase point awards.',
  )
}

export function overviewTierHoldersDetail(): string {
  return 'Users who have crossed a tier threshold and hold a non-free rank.'
}

export function overviewPendingLiabilityTooltip(usd: number): MetricTooltipData {
  return metricTip(
    'USD in pending monetary payouts awaiting the monthly Stripe aggregator run.',
    'Same liability field as Pending payout on the snapshot — sum of unsettled end_user_payouts rows.',
    usd > 0
      ? `$${usd.toFixed(2)} will move to Stripe on the next payout batch after disputes clear.`
      : 'No outstanding USD — paid tiers either disabled or all payouts settled.',
    usd > 0 ? { tone: 'warn', text: 'Review open disputes before the payout cron runs.' } : undefined,
  )
}

export function overviewPendingLiabilityDetail(): string {
  return 'USD in pending monetary payouts awaiting the monthly Stripe aggregator run.'
}
