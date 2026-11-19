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

/** @internal Exported for tests. States the program's state; the counts sit in the metrics (2026-11-18). */
export function rewardsSentence(stats: RewardsStats): string {
  // Off is about this app's new activity: points already earned still count (report 5f2ab6c5),
  // and the team's other apps keep earning, so the counts below are not this app's (2026-11-19:
  // "Rewards are off" over a feed earning +41 pts from other apps).
  if (!stats.projectRewardsEnabled) {
    return `Rewards are off for ${stats.projectName ?? 'this app'}, so its new activity earns no points. The counts cover all your apps.`
  }
  const parts = [stats.activeContributors30d > 0 ? 'Rewards are on' : 'Rewards are on; nobody earned points in the last 30 days']
  if (stats.pendingPayoutLiabilityUsd > 0) parts.push('payouts are waiting')
  if (stats.webhooksFailing > 0) parts.push(`${pluralizeWithCount(stats.webhooksFailing, 'webhook')} failing`)
  return `${parts.join('; ')}.`
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
          // Short labels: "Testers (30 / days)" wrapped at 390 (2026-11-19).
          label: statLabels?.contributors30d ?? 'Testers · 30d',
          value: stats.activeContributors30d,
          hint: 'People in any of your apps who earned points in the last 30 days.',
          to: rewardsLinks.contributors30d,
        },
        {
          label: statLabels?.points30d ?? 'Points · 30d',
          value: stats.pointsAwarded30d.toLocaleString(),
          hint: 'Points awarded across all your apps for reports, quests and other actions in the last 30 days.',
          to: rewardsLinks.points30d,
        },
        {
          label: statLabels?.pendingPayout ?? 'Payouts due',
          value: `$${stats.pendingPayoutLiabilityUsd.toFixed(2)}`,
          tone: stats.pendingPayoutLiabilityUsd > 0 ? 'warn' : 'neutral',
          hint: 'Money earned by testers and not paid out yet.',
          to: rewardsLinks.pendingPayout,
        },
      ]}
    />
  )
}
