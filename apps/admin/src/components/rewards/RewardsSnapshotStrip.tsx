/**
 * FILE: RewardsSnapshotStrip.tsx
 * PURPOSE: Tester rewards status from /v1/admin/rewards/stats, on every
 *          Rewards tab: is the program on, who earned what in 30 days, and
 *          what you owe (PageStatus, P1).
 */

import { PageStatus } from '../ui'
import type { RewardsStats } from './types'
import { pluralizeWithCount } from '../../lib/format'
import { rewardsLinks } from '../../lib/statCardLinks'

interface Props {
  stats: RewardsStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
}

function rewardsSentence(stats: RewardsStats): string {
  if (!stats.projectRewardsEnabled) return 'Rewards are off for this app.'
  const earned =
    stats.activeContributors30d > 0
      ? `${pluralizeWithCount(stats.activeContributors30d, 'tester')} earned ${stats.pointsAwarded30d.toLocaleString()} points in the last 30 days`
      : 'Rewards are on; nobody earned points in the last 30 days'
  const owed = stats.pendingPayoutLiabilityUsd > 0 ? `; $${stats.pendingPayoutLiabilityUsd.toFixed(2)} in payouts waiting` : ''
  const failing = stats.webhooksFailing > 0 ? `; ${pluralizeWithCount(stats.webhooksFailing, 'webhook')} failing` : ''
  return `${earned}${owed}${failing}.`
}

export function RewardsSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Tester rewards status"
      tone={stats.webhooksFailing > 0 ? 'danger' : stats.pendingPayoutLiabilityUsd > 0 ? 'warn' : stats.projectRewardsEnabled ? 'ok' : 'neutral'}
      sentence={rewardsSentence(stats)}
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
