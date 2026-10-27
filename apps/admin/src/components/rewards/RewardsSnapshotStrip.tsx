/**
 * FILE: RewardsSnapshotStrip.tsx
 * PURPOSE: Tester rewards status from /v1/admin/rewards/stats, on every
 *          Rewards tab: is the program on, who earned what in 30 days, and
 *          what you owe (PageStatus, P1).
 */

import type { ReactNode } from 'react'
import { PageStatus } from '../ui'
import type { RewardsStats } from './types'
import { pluralizeWithCount } from '../../lib/format'
import { rewardsLinks } from '../../lib/statCardLinks'

interface Props {
  stats: RewardsStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** The one next step, when the page has one (e.g. "Turn on rewards"). */
  action?: ReactNode
}

function rewardsSentence(stats: RewardsStats): string {
  if (!stats.projectRewardsEnabled) {
    // Off is about new activity: points already earned still count (report 5f2ab6c5).
    const earned =
      stats.activeContributors30d > 0
        ? ` In the last 30 days ${pluralizeWithCount(stats.activeContributors30d, 'tester')} earned ${stats.pointsAwarded30d.toLocaleString()} points.`
        : ''
    return `Rewards are off for this app. New activity earns no points.${earned}`
  }
  const earned =
    stats.activeContributors30d > 0
      ? `${pluralizeWithCount(stats.activeContributors30d, 'tester')} earned ${stats.pointsAwarded30d.toLocaleString()} points in the last 30 days`
      : 'Rewards are on; nobody earned points in the last 30 days'
  const owed = stats.pendingPayoutLiabilityUsd > 0 ? `; $${stats.pendingPayoutLiabilityUsd.toFixed(2)} in payouts waiting` : ''
  const failing = stats.webhooksFailing > 0 ? `; ${pluralizeWithCount(stats.webhooksFailing, 'webhook')} failing` : ''
  return `${earned}${owed}${failing}.`
}

export function RewardsSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, action }: Props) {
  return (
    <PageStatus
      ariaLabel="Tester rewards status"
      tone={stats.webhooksFailing > 0 ? 'danger' : !stats.projectRewardsEnabled ? 'warn' : stats.pendingPayoutLiabilityUsd > 0 ? 'warn' : 'ok'}
      sentence={rewardsSentence(stats)}
      action={action}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.contributors30d ?? 'Testers (30 days)',
          value: stats.activeContributors30d,
          hint: 'People who earned points in the last 30 days.',
          to: rewardsLinks.contributors30d,
        },
        {
          label: statLabels?.points30d ?? 'Points (30 days)',
          value: stats.pointsAwarded30d.toLocaleString(),
          hint: 'Points awarded for reports, quests and other actions in the last 30 days.',
          to: rewardsLinks.points30d,
        },
        {
          label: statLabels?.pendingPayout ?? 'Payouts waiting',
          value: `$${stats.pendingPayoutLiabilityUsd.toFixed(2)}`,
          tone: stats.pendingPayoutLiabilityUsd > 0 ? 'warn' : 'neutral',
          hint: 'Money earned by testers and not paid out yet.',
          to: rewardsLinks.pendingPayout,
        },
      ]}
    />
  )
}
