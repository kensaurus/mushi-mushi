/**
 * FILE: apps/admin/src/lib/statTooltips/rewards.ts
 * PURPOSE: Human-readable StatCard tooltips for the Rewards console.
 */

export type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

import type { MetricTooltipData } from '../../components/ui'
import type { RewardsStats } from '../../components/rewards/types'
import { metricTip } from '../metricTooltipBuilder'

export function contributors30dTooltip(stats: RewardsStats): MetricTooltipData {
  return metricTip(
    'Distinct end users who earned at least one reward point in the rolling last 30 days.',
    'Counts unique end_user_id values on end_user_points rows with a positive delta in the 30-day window for this org/project.',
    stats.activeContributors30d > 0
      ? `${stats.activeContributors30d} contributor${stats.activeContributors30d === 1 ? '' : 's'} active — open Contributors to see tier distribution and top earners.`
      : 'No contributors yet — enable rules and verify the SDK is sending end_user_activity events from your host app.',
    stats.activeContributors30d === 0 && stats.enabledRulesCount > 0
      ? { tone: 'info', text: 'Rules are enabled but no points logged — check identity linking and activity ingestion.' }
      : undefined,
  )
}

export function contributors30dDetail(): string {
  return 'Distinct users who earned points'
}

export function points30dTooltip(stats: RewardsStats): MetricTooltipData {
  return metricTip(
    'Total reward points credited to all users in the rolling last 30 days.',
    'Sums positive point deltas on end_user_points for the org/project within the 30-day UTC window.',
    `${stats.pointsAwarded30d.toLocaleString()} points in 30d. ${stats.activity24hTotal.toLocaleString()} SDK activity event${stats.activity24hTotal === 1 ? '' : 's'} in the last 24h feed the rules engine.`,
    stats.rejectionRatePct24h > 10
      ? { tone: 'warn', text: `${stats.rejectionRatePct24h}% of 24h activity was rejected — review anti-gaming rules.` }
      : undefined,
  )
}

export function points30dDetail(stats: RewardsStats): string {
  return `${stats.activity24hTotal} SDK events in 24h`
}

export function rulesTiersTooltip(stats: RewardsStats): MetricTooltipData {
  return metricTip(
    'How many activity rules and ladder tiers are enabled for this project.',
    'enabledRulesCount = reward_rules rows with enabled=true. enabledTiersCount = reward_tiers rows that are active steps on the ladder.',
    stats.enabledRulesCount > 0
      ? `${stats.enabledRulesCount} rule${stats.enabledRulesCount === 1 ? '' : 's'} and ${stats.enabledTiersCount} tier${stats.enabledTiersCount === 1 ? '' : 's'} live. Edit on Rules / Tiers tabs — each rule maps an SDK action to points.`
      : 'No rules enabled — contributors cannot earn points until you add at least one activity rule.',
    stats.enabledRulesCount === 0 ? { tone: 'warn', text: 'Rewards is on but the rules engine has nothing to evaluate.' } : undefined,
  )
}

export function rulesTiersDetail(): string {
  return 'Enabled activity rules and ladder steps'
}

export function questsTooltip(stats: RewardsStats): MetricTooltipData {
  return metricTip(
    'Active multi-step quest goals contributors can complete for bonus points.',
    'Counts reward_quests rows with enabled=true for the project.',
    stats.enabledQuestsCount > 0
      ? `${stats.enabledQuestsCount} quest${stats.enabledQuestsCount === 1 ? '' : 's'} running — use Quests tab to inspect progress and completion rates.`
      : 'No quests configured — optional engagement layer on top of point rules.',
  )
}

export function questsDetail(): string {
  return 'Active multi-step goals'
}

export function webhooksTooltip(stats: RewardsStats): MetricTooltipData {
  const status =
    stats.webhooksConfigured === 0
      ? 'No tier-change webhooks configured — your host app will not receive rank-up callbacks.'
      : stats.webhooksFailing > 0
        ? `${stats.webhooksFailing} webhook${stats.webhooksFailing === 1 ? '' : 's'} failing delivery — tier changes may not reach your app.`
        : `${stats.webhooksConfigured} webhook${stats.webhooksConfigured === 1 ? '' : 's'} healthy — tier promotions POST to your endpoint.`

  return metricTip(
    'Outbound webhooks that notify your host app when a contributor changes tier.',
    'Configured = reward_webhooks rows for the project. Failing = recent delivery attempts with non-2xx or timeout in webhook_delivery_log.',
    status,
    stats.webhooksFailing > 0
      ? { tone: 'warn', text: 'Fix webhook URL or signing secret in Rewards → Settings.' }
      : stats.webhooksConfigured === 0
        ? { tone: 'info', text: 'Optional — add a webhook if your app shows tier badges in-product.' }
        : undefined,
  )
}

export function webhooksDetail(_stats: RewardsStats): string {
  return 'Tier-change delivery to host app'
}

export function pendingPayoutTooltip(stats: RewardsStats): MetricTooltipData {
  return metricTip(
    'USD liability from monetary reward tiers awaiting the monthly Stripe payout aggregator.',
    'Sums pending_payout_usd on end_user_payouts with status pending for the org — converted from point thresholds on paid tiers.',
    stats.pendingPayoutLiabilityUsd > 0
      ? `$${stats.pendingPayoutLiabilityUsd.toFixed(2)} outstanding — runs on the monthly payout cron after dispute window closes.`
      : 'No pending USD payouts — either no paid tiers or all liabilities were settled.',
    stats.rejectionRatePct24h > 0
      ? { tone: 'info', text: `${stats.rejectionRatePct24h}% of 24h activity rejected — may reduce future payout eligibility.` }
      : undefined,
  )
}

export function pendingPayoutDetail(stats: RewardsStats): string {
  return stats.rejectionRatePct24h > 0
    ? `${stats.rejectionRatePct24h}% rejected in 24h`
    : 'USD awaiting monthly run'
}

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
