/**
 * FILE: apps/admin/src/components/explore/ExploreStatusBanner.tsx
 * PURPOSE: Codebase atlas posture — indexing, errors, ready, stale.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { ExploreStats, ExploreTabId } from './ExploreStatsTypes'

interface Props {
  stats: ExploreStats
  onTab?: (tab: ExploreTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
}

export function ExploreStatusBanner({ stats, onTab, onRefresh, refreshing }: Props) {
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No projects — atlas empty</p>
            <p className="text-2xs text-fg-muted">Create a project on Setup before indexing a codebase.</p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">Go to Setup</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'not_enabled') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">Indexing not enabled on {projectLabel}</p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">Open Index tab</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('index')}>
            Open Index tab
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'error') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">Index error on {projectLabel}</p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">Debug index</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('index')}>
            Debug index
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'indexing') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info animate-pulse" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Indexing in progress</p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            Refresh
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'empty') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">No files indexed on {projectLabel}</p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        <Link to="/settings">
          <Btn size="sm" variant="ghost">Open Settings</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'stale') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Index may be stale</p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel}
              {stats.lastIndexedAt ? (
                <> · last indexed <RelativeTime value={stats.lastIndexedAt} /></>
              ) : null}
            </p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">Open Graph</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('graph')}>
            Open Graph
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
          <p className="text-xs font-medium text-ok">Atlas ready on {projectLabel}</p>
          <p className="text-2xs text-fg-muted">
            {stats.topPriorityLabel}
            {stats.lastIndexedAt ? (
              <> · indexed <RelativeTime value={stats.lastIndexedAt} /></>
            ) : null}
          </p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          Refresh
        </Btn>
      ) : stats.topPriorityTo ? (
        <Link to={stats.topPriorityTo}>
          <Btn size="sm" variant="ghost">Open Graph</Btn>
        </Link>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('graph')}>
          Open Graph
        </Btn>
      ) : null}
    </div>
  )
}
