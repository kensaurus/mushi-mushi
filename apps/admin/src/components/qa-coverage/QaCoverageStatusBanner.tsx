/**
 * FILE: apps/admin/src/components/qa-coverage/QaCoverageStatusBanner.tsx
 * PURPOSE: QA Coverage posture — no stories, failing, pending, idle, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { QaCoverageStats, QaCoverageTabId } from './QaCoverageStatsTypes'

interface Props {
  stats: QaCoverageStats
  onTab?: (tab: QaCoverageTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  onCreateStory?: () => void
  plainBanner?: boolean
}

export function QaCoverageStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  onCreateStory,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/qa-coverage')
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
                ? 'QA tests run per app — choose one in the header.'
                : 'Pick a project to manage QA stories and scheduled runs.'}
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'no_stories') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? 'No automated tests yet' : `No QA stories on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onCreateStory ? (
          <Btn size="sm" variant="ghost" onClick={onCreateStory}>{actions.newStory ?? '+ New story'}</Btn>
        ) : (
          <Link to="/qa-coverage?tab=overview">
            <Btn size="sm" variant="ghost">{actions.create ?? 'Create story'}</Btn>
          </Link>
        )}
      </div>
    )
  }

  if (stats.topPriority === 'failing') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner
                ? `${stats.failingStories} test${stats.failingStories === 1 ? '' : 's'} failing`
                : `${stats.failingStories} failing stor${stats.failingStories === 1 ? 'y' : 'ies'} (24h)`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.failures ?? 'Review failures'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('failing')}>{actions.failures ?? 'Review failures'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'pending') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand motion-safe:animate-pulse" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner
                ? `${stats.pendingRuns} test run${stats.pendingRuns === 1 ? '' : 's'} in progress`
                : `${stats.pendingRuns} run${stats.pendingRuns === 1 ? '' : 's'} in flight`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('stories')}>{actions.stories ?? 'View stories'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'no_runs' || stats.topPriority === 'disabled_all') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? stats.topPriority === 'disabled_all'
                  ? 'All tests are turned off'
                  : 'No test runs in the last 24 hours'
                : stats.topPriority === 'disabled_all'
                  ? 'All stories disabled'
                  : 'No runs in the last 24h'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.openStories ?? 'Open stories'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('stories')}>{actions.openStories ?? 'Open stories'}</Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {plainBanner ? 'Automated QA is healthy' : `QA coverage healthy on ${projectLabel}`}
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
          <Btn size="sm" variant="ghost">{actions.stories ?? 'View stories'}</Btn>
        </Link>
      ) : null}
    </div>
  )
}
