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
  onRefresh?: () => void
  refreshing?: boolean
}

function tabFromPath(path: string | null): RewardsTabId | null {
  if (!path) return null
  const tab = new URL(path, 'http://local').searchParams.get('tab')
  if (
    tab === 'overview' ||
    tab === 'rules' ||
    tab === 'tiers' ||
    tab === 'contributors' ||
    tab === 'quests' ||
    tab === 'analytics' ||
    tab === 'sandbox' ||
    tab === 'settings'
  ) {
    return tab
  }
  return null
}

export function RewardsStatusBanner({ stats, rewardsEntitlement, onTab, onRefresh, refreshing }: Props) {
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

  const priority = stats.topPriority
  const label = stats.topPriorityLabel
  const actionTab = tabFromPath(stats.topPriorityTo)

  if (priority === 'project_disabled') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Rewards disabled for {projectLabel}</p>
            <p className="text-2xs text-fg-muted">{label ?? 'Turn on rewards_enabled in project settings.'}</p>
          </div>
        </div>
        <Link to="/settings?tab=dev">
          <Btn size="sm" variant="primary">Open Settings</Btn>
        </Link>
      </div>
    )
  }

  if (priority === 'webhooks_failing') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.webhooksFailing} reward webhook{stats.webhooksFailing === 1 ? '' : 's'} failing
            </p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab && actionTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab(actionTab)}>Fix webhooks</Btn>
        ) : (
          <Link to="/rewards?tab=settings">
            <Btn size="sm" variant="ghost">Fix webhooks</Btn>
          </Link>
        )}
      </div>
    )
  }

  if (priority === 'open_disputes') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.openDisputesCount} open dispute{stats.openDisputesCount === 1 ? '' : 's'}
            </p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab && actionTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab(actionTab)}>Review disputes</Btn>
        ) : (
          <Link to="/rewards?tab=settings">
            <Btn size="sm" variant="ghost">Review disputes</Btn>
          </Link>
        )}
      </div>
    )
  }

  if (priority === 'no_rules') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">No activity rules enabled</p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="primary" onClick={() => onTab('rules')}>Add rules</Btn>
        ) : null}
      </div>
    )
  }

  if (priority === 'high_rejection') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              High rejection rate — {stats.rejectionRatePct24h}% in 24h
            </p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('overview')}>Debug feed</Btn>
        ) : null}
      </div>
    )
  }

  if (priority === 'no_contributors') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">Program configured — no contributor activity yet</p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="primary" onClick={() => onTab('sandbox')}>Run simulator</Btn>
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
          <p className="text-2xs text-fg-muted">{label}</p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          Refresh
        </Btn>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('contributors')}>View leaderboard</Btn>
      ) : null}
    </div>
  )
}
