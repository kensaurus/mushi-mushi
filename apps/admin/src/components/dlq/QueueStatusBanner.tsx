/**
 * FILE: apps/admin/src/components/dlq/QueueStatusBanner.tsx
 * PURPOSE: Processing queue posture — dead letter, failed, circuit breaker, stalled, healthy.
 */

import { deadLetterHint, scopedHref } from '../../lib/humanPageHints'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
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
  const pid = stats.projectId

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title="No projects — queue empty"
        subtitle="Create a project before reports enter the pipeline."
        action={<StatusBannerAction label="Go to Setup" to="/onboarding" tone="info" />}
      />
    )
  }

  if (stats.topPriority === 'dead_letter') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          `${stats.deadLetter} report${stats.deadLetter === 1 ? '' : 's'} stuck after retries on ${projectLabel}`
        }
        subtitle={stats.topPriorityLabel ?? deadLetterHint(stats.deadLetter)}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label="Inspect dead-letter queue"
              to={stats.topPriorityTo}
              tone="danger"
            />
          ) : onTab ? (
            <StatusBannerAction label="Open stuck items" onClick={() => onTab('items')} tone="danger" />
          ) : (
            <StatusBannerAction
              label="Inspect dead-letter queue"
              to={scopedHref('/queue?tab=items&filter=dead_letter', pid)}
              tone="danger"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'failed') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.failed} pipeline job${stats.failed === 1 ? '' : 's'} failed`}
        subtitle={
          stats.topPriorityLabel ??
          'A background step broke while processing reports — inspect the failure before replaying.'
        }
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction label="Inspect failures" to={stats.topPriorityTo} tone="warn" />
          ) : (
            <StatusBannerAction
              label="Inspect failures"
              to={scopedHref('/queue?tab=items&filter=failed', pid)}
              tone="warn"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'circuit_breaker') {
    return (
      <StatusBannerShell
        tone="brand"
        title={`${stats.reportsQueued} report${stats.reportsQueued === 1 ? '' : 's'} paused by circuit breaker`}
        subtitle={
          stats.topPriorityLabel ??
          'Ingest is temporarily throttled to protect the pipeline — flush when the upstream issue is fixed.'
        }
        action={
          onFlush ? (
            <StatusBannerAction
              label="Flush queued reports"
              onClick={onFlush}
              loading={flushing}
              disabled={flushing}
              tone="brand"
            />
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
        subtitle={
          stats.topPriorityLabel ??
          'Reports are not moving through triage — recover stranded jobs or refresh to see current state.'
        }
        action={
          onRecover ? (
            <StatusBannerAction
              label="Recover stranded jobs"
              onClick={onRecover}
              loading={recovering}
              disabled={recovering}
              tone="warn"
            />
          ) : onRefresh ? (
            <StatusBannerAction
              label="Refresh"
              onClick={onRefresh}
              loading={refreshing}
              disabled={refreshing}
              tone="warn"
              emphasis="ghost"
            />
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
          <StatusBannerAction
            label="Refresh"
            onClick={onRefresh}
            loading={refreshing}
            disabled={refreshing}
            tone="ok"
            emphasis="ghost"
          />
        ) : stats.topPriorityTo ? (
          <StatusBannerAction label="View backlog" to={stats.topPriorityTo} tone="ok" />
        ) : onTab ? (
          <StatusBannerAction label="View backlog" onClick={() => onTab('backlog')} tone="ok" />
        ) : null
      }
    />
  )
}
