/**
 * FILE: apps/admin/src/components/experiments/ExperimentsStatusBanner.tsx
 * PURPOSE: A/B experiment posture — no data, drafts ready, running, winners, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { ExperimentsStats, ExperimentsTabId } from './ExperimentsStatsTypes'

interface Props {
  stats: ExperimentsStats
  onTab?: (tab: ExperimentsTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function ExperimentsStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/experiments')
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
                ? 'A/B tests are per app — choose one in the header.'
                : 'Pick a project to create and monitor A/B experiments.'}
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'running') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `${stats.runningCount} experiment${stats.runningCount === 1 ? '' : 's'} live`
                : `${stats.runningCount} experiment${stats.runningCount === 1 ? '' : 's'} live on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.monitor ?? 'Monitor runs'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('experiments')}>{actions.monitor ?? 'Monitor runs'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'draft_ready') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {stats.draftsReadyToLaunch} draft{stats.draftsReadyToLaunch === 1 ? '' : 's'} ready to launch
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.drafts ?? 'Review drafts'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('experiments')}>{actions.drafts ?? 'Review drafts'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'no_experiments') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? 'No experiments yet' : `No experiments on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.create ?? 'Create experiment'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('new')}>{actions.create ?? 'Create experiment'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'winners_found') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
          <div>
            <p className="text-xs font-medium text-ok">
              {stats.winnersFound} winner{stats.winnersFound === 1 ? '' : 's'} declared
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.winners ?? 'Review winners'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('experiments')}>{actions.winners ?? 'Review winners'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'draft_incomplete') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Draft experiments need variants</p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('experiments')}>{actions.finish ?? 'Finish setup'}</Btn>
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
            {plainBanner ? 'Experiment library idle' : `Experiment library idle on ${projectLabel}`}
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
          <Btn size="sm" variant="ghost">{actions.monitor ?? 'View experiments'}</Btn>
        </Link>
      ) : null}
    </div>
  )
}
