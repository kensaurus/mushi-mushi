/**
 * FILE: apps/admin/src/components/rewards/RewardsStatusBanner.tsx
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="warn"
        title="No organization selected"
        subtitle="Rewards is org-scoped — pick a team from the header org switcher before configuring rules or tiers."
      />
    )
  }

  if (!rewardsEntitlement) {
    return (
      <StatusBannerShell
        tone="warn"
        title="Rewards program requires Starter or higher"
        subtitle={`Preview tabs below are read-only on Hobby — upgrade to edit rules, tiers, and webhooks for ${orgLabel}.`}
        action={
          <Link to="/billing">
            <Btn size="sm" variant="ghost">View plans</Btn>
          </Link>
        }
      />
    )
  }

  const priority = stats.topPriority
  const label = stats.topPriorityLabel
  const actionTab = tabFromPath(stats.topPriorityTo)

  if (priority === 'project_disabled') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`Rewards disabled for ${projectLabel}`}
        subtitle={label ?? 'Turn on rewards_enabled in project settings.'}
        action={
          <Link to="/settings?tab=dev">
            <Btn size="sm" variant="primary">Open Settings</Btn>
          </Link>
        }
      />
    )
  }

  if (priority === 'webhooks_failing') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.webhooksFailing} reward webhook${stats.webhooksFailing === 1 ? '' : 's'} failing`}
        subtitle={label}
        action={
          onTab && actionTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab(actionTab)}>Fix webhooks</Btn>
          ) : (
            <Link to="/rewards?tab=settings">
              <Btn size="sm" variant="ghost">Fix webhooks</Btn>
            </Link>
          )
        }
      />
    )
  }

  if (priority === 'open_disputes') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.openDisputesCount} open dispute${stats.openDisputesCount === 1 ? '' : 's'}`}
        subtitle={label}
        action={
          onTab && actionTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab(actionTab)}>Review disputes</Btn>
          ) : (
            <Link to="/rewards?tab=settings">
              <Btn size="sm" variant="ghost">Review disputes</Btn>
            </Link>
          )
        }
      />
    )
  }

  if (priority === 'no_rules') {
    return (
      <StatusBannerShell
        tone="warn"
        title="No activity rules enabled"
        subtitle={label}
        action={onTab ? <Btn size="sm" variant="primary" onClick={() => onTab('rules')}>Add rules</Btn> : null}
      />
    )
  }

  if (priority === 'high_rejection') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`High rejection rate — ${stats.rejectionRatePct24h}% in 24h`}
        subtitle={label}
        action={onTab ? <Btn size="sm" variant="ghost" onClick={() => onTab('overview')}>Debug feed</Btn> : null}
      />
    )
  }

  if (priority === 'no_contributors') {
    return (
      <StatusBannerShell
        tone="brand"
        title="Program configured — no contributor activity yet"
        subtitle={label}
        action={onTab ? <Btn size="sm" variant="primary" onClick={() => onTab('sandbox')}>Run simulator</Btn> : null}
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`Rewards loop active for ${orgLabel}`}
      subtitle={label}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            Refresh
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('contributors')}>View leaderboard</Btn>
        ) : null
      }
    />
  )
}
