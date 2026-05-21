/**
 * FILE: apps/admin/src/components/lessons/LessonsStatusBanner.tsx
 * PURPOSE: Lessons posture — no data, candidates ready, critical rules, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { LessonsStats, LessonsTabId } from './LessonsStatsTypes'

interface Props {
  stats: LessonsStats
  onTab?: (tab: LessonsTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function LessonsStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/lessons')
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
                ? 'Mistake memory is per app — choose one in the header.'
                : 'Pick a project to view mistake clusters and promoted lessons.'}
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'no_data') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? 'No lesson memory yet' : `No lesson memory on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        <Link to="/reports">
          <Btn size="sm" variant="ghost">{actions.reports ?? 'Open Reports'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'candidates_ready' || stats.topPriority === 'no_lessons') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.topPriority === 'candidates_ready'
                ? `${stats.readyToPromote} cluster${stats.readyToPromote === 1 ? '' : 's'} ready to promote`
                : `${stats.candidateClusters} cluster${stats.candidateClusters === 1 ? '' : 's'} forming`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.clusters ?? 'Review clusters'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('clusters')}>{actions.clusters ?? 'Review clusters'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'critical_lessons') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.criticalLessons} critical lesson{stats.criticalLessons === 1 ? '' : 's'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('lessons')}>{actions.lessons ?? 'Review lessons'}</Btn>
        ) : (
          <Link to="/lessons?tab=lessons">
            <Btn size="sm" variant="ghost">{actions.lessons ?? 'Review lessons'}</Btn>
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
            {plainBanner ? 'Lesson memory active' : `Lesson memory active on ${projectLabel}`}
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
          <Btn size="sm" variant="ghost">{actions.query ?? 'Try query sim'}</Btn>
        </Link>
      ) : null}
    </div>
  )
}
