/**
 * FILE: apps/admin/src/components/iterate/IterateStatusBanner.tsx
 * PURPOSE: PDCA pipeline posture — active runs, queued waiting trigger, failures, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
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
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Pick a project first' : 'No project selected'}
            </p>
            <p className="text-2xs text-fg-muted">
              {plainBanner
                ? 'Page improvement runs are per app — choose one in the header.'
                : 'Pick a project to queue producer/critic PDCA loops.'}
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'active_runs') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn motion-safe:animate-pulse" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `${stats.running} improvement run${stats.running === 1 ? '' : 's'} in progress`
                : `${stats.running} run${stats.running === 1 ? '' : 's'} running on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.runs ?? 'View runs'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('runs')}>{actions.runs ?? 'View runs'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'queued_waiting') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {stats.queued} run{stats.queued === 1 ? '' : 's'} waiting for Trigger
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="primary" onClick={() => onTab('runs')}>{actions.openRuns ?? 'Open runs'}</Btn>
        ) : (
          <Link to="/iterate?tab=runs">
            <Btn size="sm" variant="primary">{actions.openRuns ?? 'Open runs'}</Btn>
          </Link>
        )}
      </div>
    )
  }

  if (stats.topPriority === 'last_failed') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">Latest improvement run failed</p>
            <p className="text-2xs text-fg-muted truncate max-w-prose" title={stats.lastFailedUrl ?? undefined}>
              {stats.topPriorityLabel}
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('new')}>{actions.queue ?? 'Queue new run'}</Btn>
        ) : (
          <Link to="/iterate?tab=new">
            <Btn size="sm" variant="ghost">{actions.queue ?? 'Queue new run'}</Btn>
          </Link>
        )}
      </div>
    )
  }

  if (stats.topPriority === 'no_runs') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? 'No improvement runs yet' : `No PDCA runs on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="primary" onClick={() => onTab('new')}>{actions.newRun ?? 'New run'}</Btn>
        ) : (
          <Link to="/iterate?tab=new">
            <Btn size="sm" variant="primary">{actions.newRun ?? 'New run'}</Btn>
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {plainBanner ? 'Improvement pipeline idle' : `PDCA pipeline idle on ${projectLabel}`}
          </p>
          <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          {actions.refresh ?? 'Refresh'}
        </Btn>
      ) : stats.topPriorityTo ? (
        <Link to={stats.topPriorityTo}>
          <Btn size="sm" variant="ghost">{actions.runs ?? 'View runs'}</Btn>
        </Link>
      ) : null}
    </div>
  )
}
