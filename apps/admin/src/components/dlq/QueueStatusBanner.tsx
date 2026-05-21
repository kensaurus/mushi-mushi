/**
 * FILE: apps/admin/src/components/dlq/QueueStatusBanner.tsx
 * PURPOSE: Processing queue posture — dead letter, failed, circuit breaker, stalled, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { QueueStats, QueueTabId } from './QueueStatsTypes'

interface Props {
  stats: QueueStats
  onTab?: (tab: QueueTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  onRecover?: () => void
  onFlush?: () => void
  recovering?: boolean
  flushing?: boolean
}

export function QueueStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  onRecover,
  onFlush,
  recovering,
  flushing,
}: Props) {
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title="No projects — queue empty"
        subtitle="Create a project before reports enter the pipeline."
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">Go to Setup</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'dead_letter') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.deadLetter} dead-letter on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">Open dead-letter</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('items')}>
              Open items
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'failed') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.failed} failed job${stats.failed === 1 ? '' : 's'}`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">Inspect failures</Btn>
            </Link>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'circuit_breaker') {
    return (
      <StatusBannerShell
        tone="brand"
        title={`${stats.reportsQueued} report${stats.reportsQueued === 1 ? '' : 's'} behind circuit breaker`}
        subtitle={stats.topPriorityLabel}
        action={
          onFlush ? (
            <Btn size="sm" variant="ghost" onClick={onFlush} loading={flushing} disabled={flushing}>
              Flush queued
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'stalled') {
    return (
      <StatusBannerShell
        tone="warn"
        title="Pipeline may be stalled"
        subtitle={stats.topPriorityLabel}
        action={
          onRecover ? (
            <Btn size="sm" variant="ghost" onClick={onRecover} loading={recovering} disabled={recovering}>
              Recover stranded
            </Btn>
          ) : onRefresh ? (
            <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
              Refresh
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`Queue healthy on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            Refresh
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">View backlog</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('backlog')}>
            View backlog
          </Btn>
        ) : null
      }
    />
  )
}
