/**
 * FILE: RewardsSnapshotStrip.tsx
 * PURPOSE: Posture KPI strip backed by /v1/admin/rewards/stats — visible on
 *          every Rewards tab so operators see health without switching to Overview.
 */

import { Link } from 'react-router-dom'
import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { RewardsStats } from './types'
import {
  contributors30dDetail,
  contributors30dTooltip,
  pendingPayoutDetail,
  pendingPayoutTooltip,
  points30dDetail,
  points30dTooltip,
  questsDetail,
  questsTooltip,
  rulesTiersDetail,
  rulesTiersTooltip,
  webhooksDetail,
  webhooksTooltip,
} from '../../lib/statTooltips/rewards'
import { rewardsLinks } from '../../lib/statCardLinks'

interface Props {
  stats: RewardsStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  description?: string
  sectionTitle?: string
  statLabels?: Record<string, string>
  hideLinks?: boolean
  /** Quick/Beginner: 4 headline stats instead of 6. */
  compact?: boolean
}

export function RewardsSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  description,
  sectionTitle = 'REWARDS SNAPSHOT',
  statLabels,
  hideLinks = false,
  compact = false,
}: Props) {
  const rulesTiersValue = `${stats.enabledRulesCount} / ${stats.enabledTiersCount}`
  const webhookValue =
    stats.webhooksConfigured === 0
      ? 'None'
      : stats.webhooksFailing > 0
        ? `${stats.webhooksFailing} failing`
        : `${stats.webhooksConfigured} ok`

  return (
    <Section
      title={sectionTitle}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
    >
      <SnapshotSectionHint text={description} />
      <MetricStrip
        cols={compact ? 4 : 6}
        ariaLabel="Rewards program snapshot"
        className={compact ? '' : 'sm:grid-cols-3'}
      >
        <StatCard
          label={statLabels?.contributors30d ?? 'Active contributors (30d)'}
          value={stats.activeContributors30d}
          accent={stats.activeContributors30d > 0 ? 'text-brand' : undefined}
          tooltip={contributors30dTooltip(stats)}
          detail={contributors30dDetail()}
          to={rewardsLinks.contributors30d}
        />
        <StatCard
          label={statLabels?.points30d ?? 'Points awarded (30d)'}
          value={stats.pointsAwarded30d.toLocaleString()}
          accent={stats.pointsAwarded30d > 0 ? 'text-ok' : undefined}
          tooltip={points30dTooltip(stats)}
          detail={points30dDetail(stats)}
          to={rewardsLinks.points30d}
        />
        <StatCard
          label={statLabels?.rulesTiers ?? 'Rules / tiers'}
          value={rulesTiersValue}
          accent={
            stats.enabledRulesCount === 0
              ? 'text-warn'
              : stats.enabledTiersCount > 0
                ? 'text-ok'
                : undefined
          }
          tooltip={rulesTiersTooltip(stats)}
          detail={rulesTiersDetail()}
          to={rewardsLinks.rulesTiers}
        />
        {!compact ? (
          <StatCard
            label={statLabels?.quests ?? 'Quests'}
            value={stats.enabledQuestsCount}
            accent={stats.enabledQuestsCount > 0 ? 'text-info' : undefined}
            tooltip={questsTooltip(stats)}
            detail={questsDetail()}
            to={rewardsLinks.quests}
          />
        ) : null}
        <StatCard
          label={statLabels?.webhooks ?? 'Webhooks'}
          value={webhookValue}
          accent={
            stats.webhooksFailing > 0
              ? 'text-danger'
              : stats.webhooksConfigured > 0
                ? 'text-ok'
                : undefined
          }
          tooltip={webhooksTooltip(stats)}
          detail={webhooksDetail(stats)}
          to={rewardsLinks.webhooks}
        />
        {!compact ? (
          <StatCard
            label={statLabels?.pendingPayout ?? 'Pending liability'}
            value={`$${stats.pendingPayoutLiabilityUsd.toFixed(2)}`}
            accent={stats.pendingPayoutLiabilityUsd > 0 ? 'text-warn' : undefined}
            tooltip={pendingPayoutTooltip(stats)}
            detail={pendingPayoutDetail(stats)}
            to={rewardsLinks.pendingPayout}
          />
        ) : null}
      </MetricStrip>
      {!hideLinks ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-muted">
          <Link to="/rewards?tab=contributors" className="text-brand hover:underline">
            Leaderboard →
          </Link>
          <Link to="/rewards?tab=rules" className="hover:text-fg underline-offset-2 hover:underline">
            Activity rules →
          </Link>
          <Link to="/rewards?tab=settings" className="hover:text-fg underline-offset-2 hover:underline">
            Webhooks →
          </Link>
          <Link to="/anti-gaming" className="hover:text-fg underline-offset-2 hover:underline">
            Anti-gaming →
          </Link>
        </div>
      ) : null}
    </Section>
  )
}
