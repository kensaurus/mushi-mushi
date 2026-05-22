/**
 * FILE: apps/admin/src/components/iterate/IterateStatusBanner.tsx
 * PURPOSE: PDCA pipeline posture — active runs, queued waiting trigger, failures, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { IterateStats, IterateTabId } from './IterateStatsTypes'

interface Props {
  stats: IterateStats
  onTab?: (tab: IterateTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function IterateStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/iterate')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'Page improvement runs are per app — choose one in the header.'
            : 'Pick a project to queue producer/critic PDCA loops.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'active_runs') {
    return (
      <StatusBannerShell
        tone="warn"
        pulseDot
        title={
          plainBanner
            ? `${stats.running} improvement run${stats.running === 1 ? '' : 's'} in progress`
            : `${stats.running} run${stats.running === 1 ? '' : 's'} running on ${projectLabel}`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.runs ?? 'View runs'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('runs')}>{actions.runs ?? 'View runs'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'queued_waiting') {
    return (
      <StatusBannerShell
        tone="brand"
        title={`${stats.queued} run${stats.queued === 1 ? '' : 's'} waiting for Trigger`}
        subtitle={stats.topPriorityLabel}
        action={
          onTab ? (
            <Btn size="sm" variant="primary" onClick={() => onTab('runs')}>{actions.openRuns ?? 'Open runs'}</Btn>
          ) : (
            <Link to="/iterate?tab=runs">
              <Btn size="sm" variant="primary">{actions.openRuns ?? 'Open runs'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  if (stats.topPriority === 'last_failed') {
    return (
      <StatusBannerShell
        tone="danger"
        title="Latest improvement run failed"
        subtitle={
          <span className="truncate max-w-prose" title={stats.lastFailedUrl ?? undefined}>
            {stats.topPriorityLabel}
          </span>
        }
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('new')}>{actions.queue ?? 'Queue new run'}</Btn>
          ) : (
            <Link to="/iterate?tab=new">
              <Btn size="sm" variant="ghost">{actions.queue ?? 'Queue new run'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  if (stats.topPriority === 'no_runs') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No improvement runs yet' : `No PDCA runs on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          onTab ? (
            <Btn size="sm" variant="primary" onClick={() => onTab('new')}>{actions.newRun ?? 'New run'}</Btn>
          ) : (
            <Link to="/iterate?tab=new">
              <Btn size="sm" variant="primary">{actions.newRun ?? 'New run'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Improvement pipeline idle' : `PDCA pipeline idle on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.runs ?? 'View runs'}</Btn>
          </Link>
        ) : null
      }
    />
  )
}
