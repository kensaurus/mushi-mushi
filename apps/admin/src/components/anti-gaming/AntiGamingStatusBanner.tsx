/**
 * FILE: apps/admin/src/components/anti-gaming/AntiGamingStatusBanner.tsx
 * PURPOSE: Intake integrity posture — cross-account, flagged, velocity, clean.
 */

import { Btn, RelativeTime } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { AntiGamingStats, AntiGamingTabId } from './AntiGamingStatsTypes'

interface Props {
  stats: AntiGamingStats
  onTab?: (tab: AntiGamingTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
}

export function AntiGamingStatusBanner({ stats, onTab, onRefresh, refreshing }: Props) {
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title="No projects — anti-gaming idle"
        subtitle="Create a project and ingest reports before devices appear."
        action={
          <Btn to="/onboarding" size="sm" variant="ghost">Go to Setup</Btn>
        }
      />
    )
  }

  if (stats.topPriority === 'waiting') {
    return (
      <StatusBannerShell
        tone="brand"
        title={`Waiting for SDK devices on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          <Btn to="/onboarding?tab=verify" size="sm" variant="ghost">Send test report</Btn>
        }
      />
    )
  }

  if (stats.topPriority === 'cross_account') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.crossAccountDevices} cross-account on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          // The page's handler filters and scrolls; a bare link to the same
          // page only changed the URL.
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('devices')}>
              Review devices
            </Btn>
          ) : stats.topPriorityTo ? (
            <Btn to={stats.topPriorityTo} size="sm" variant="ghost">Review devices</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'flagged') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.flaggedDevices} flagged device${stats.flaggedDevices === 1 ? '' : 's'}`}
        subtitle={stats.topPriorityLabel}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('devices')}>
              Open flagged
            </Btn>
          ) : stats.topPriorityTo ? (
            <Btn to={stats.topPriorityTo} size="sm" variant="ghost">Open flagged</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'velocity') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.velocityEvents24h} velocity anomal${stats.velocityEvents24h === 1 ? 'y' : 'ies'} (24h)`}
        subtitle={stats.topPriorityLabel}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('events')}>
              Open events
            </Btn>
          ) : stats.topPriorityTo ? (
            <Btn to={stats.topPriorityTo} size="sm" variant="ghost">Open events</Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`Intake clean on ${projectLabel}`}
      subtitle={
        <>
          {stats.topPriorityLabel}
          {stats.lastEventAt ? (
            <> · last event <RelativeTime value={stats.lastEventAt} /></>
          ) : null}
        </>
      }
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            Refresh
          </Btn>
        ) : stats.topPriorityTo ? (
          <Btn to={stats.topPriorityTo} size="sm" variant="ghost">View devices</Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('devices')}>
            View devices
          </Btn>
        ) : null
      }
    />
  )
}
