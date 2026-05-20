/**
 * FILE: apps/admin/src/components/rewards/RewardsStatusBanner.tsx
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { RewardsStats, RewardsTabId } from './types'

interface Props {
  stats: RewardsStats
  rewardsEntitlement: boolean
  onTab?: (tab: RewardsTabId) => void
}

export function RewardsStatusBanner({ stats, rewardsEntitlement, onTab }: Props) {
  const orgLabel = stats.organizationName ?? 'this organization'
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.organizationId) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">No organization selected</p>
            <p className="text-2xs text-fg-muted">
              Rewards is org-scoped — pick a team from the header org switcher before configuring rules or tiers.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!rewardsEntitlement) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Rewards program requires Starter or higher</p>
            <p className="text-2xs text-fg-muted">
              Preview tabs below are read-only on Hobby — upgrade to edit rules, tiers, and webhooks for {orgLabel}.
            </p>
          </div>
        </div>
        <Link to="/billing">
          <Btn size="sm" variant="ghost">View plans</Btn>
        </Link>
      </div>
    )
  }

  if (!stats.projectRewardsEnabled) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Rewards disabled for {projectLabel}</p>
            <p className="text-2xs text-fg-muted">
              SDK activity ingest returns early when rewards_enabled is off — turn it on in project settings.
            </p>
          </div>
        </div>
        <Link to="/settings?tab=dev">
          <Btn size="sm" variant="ghost">Open Settings</Btn>
        </Link>
      </div>
    )
  }

  if (stats.webhooksFailing > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.webhooksFailing} reward webhook{stats.webhooksFailing === 1 ? '' : 's'} failing
            </p>
            <p className="text-2xs text-fg-muted">
              Tier-change events may not reach your host app — open Settings and re-test delivery.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('settings')}>
            Fix webhooks
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.enabledRulesCount === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">No activity rules enabled</p>
            <p className="text-2xs text-fg-muted">
              SDK events won&apos;t award points until at least one rule is on — configure Activity rules for {orgLabel}.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('rules')}>
            Add rules
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.rejectionRatePct24h >= 40 && stats.activity24hTotal >= 5) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              High rejection rate — {stats.rejectionRatePct24h}% in 24h
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.activity24hRejected} of {stats.activity24hTotal} events rejected — check caps, fraud flags, or unknown actions on Overview.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('overview')}>
            Debug feed
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.activeContributors30d === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Program configured — no contributor activity yet</p>
            <p className="text-2xs text-fg-muted">
              {stats.enabledRulesCount} rules · {stats.enabledTiersCount} tiers · wire SDK identify() + activity calls in {projectLabel}.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('sandbox')}>
            Run simulator
          </Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">Rewards loop active for {orgLabel}</p>
          <p className="text-2xs text-fg-muted">
            {stats.activeContributors30d} contributors (30d) · {stats.pointsAwarded30d.toLocaleString()} pts
            {stats.pendingPayoutLiabilityUsd > 0
              ? ` · $${stats.pendingPayoutLiabilityUsd.toFixed(2)} pending payouts`
              : ''}
          </p>
        </div>
      </div>
      {onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('contributors')}>
          View leaderboard
        </Btn>
      ) : null}
    </div>
  )
}
