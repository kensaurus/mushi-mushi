/**
 * FILE: apps/admin/src/components/graph/GraphStatusBanner.tsx
 * PURPOSE: Knowledge graph posture — ingest, empty, fragile, regressions, clear.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { GraphStats, GraphTabId } from './GraphStatsTypes'

interface Props {
  stats: GraphStats
  onTab?: (tab: GraphTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function GraphStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/graph')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Create a project before the bug map can load' : 'No projects — graph empty'}
            </p>
            <p className="text-2xs text-fg-muted">
              {plainBanner
                ? 'The map fills in automatically once bugs start arriving.'
                : 'Create a project and ingest reports before the map can populate.'}
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'waiting_ingest' || !stats.hasIngest) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? `Waiting for the first bug on ${projectLabel}` : `Waiting for first report on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                (plainBanner
                  ? 'Send a test bug — the map links it to screens and components.'
                  : 'The graph seeds automatically as the classifier links reports to components and pages.')}
            </p>
          </div>
        </div>
        <Link to={stats.topPriorityTo ?? '/onboarding?tab=verify'}>
          <Btn size="sm" variant="ghost">{actions.verify ?? 'Send test report'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'empty') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner ? 'Bugs arrived but the map is still empty' : 'Graph empty despite ingest'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.reports ?? 'Open Reports'}</Btn>
          </Link>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'fragile') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner
                ? `${stats.fragileComponents} hotspot${stats.fragileComponents === 1 ? '' : 's'} — many bugs land here`
                : `${stats.fragileComponents} fragile component${stats.fragileComponents === 1 ? '' : 's'}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.explore ?? 'Open map'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('explore')}>
            {actions.explore ?? 'Open map'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'regressions') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `${stats.regressionEdges} bug${stats.regressionEdges === 1 ? '' : 's'} came back after a fix`
                : `${stats.regressionEdges} regression edge${stats.regressionEdges === 1 ? '' : 's'}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.regressions ?? 'View regressions'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('explore')}>
            {actions.regressions ?? 'View regressions'}
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
          <p className="text-xs font-medium text-ok">
            {plainBanner ? `Bug map is current on ${projectLabel}` : `Graph current on ${projectLabel}`}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.topPriorityLabel ?? (
              <>
                {stats.nodeCount} nodes · {stats.edgeCount} edges
                {stats.lastNodeAt ? (
                  <>
                    {' '}
                    · last node <RelativeTime value={stats.lastNodeAt} />
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          {actions.refresh ?? 'Refresh'}
        </Btn>
      ) : stats.topPriorityTo ? (
        <Link to={stats.topPriorityTo}>
          <Btn size="sm" variant="ghost">{actions.explore ?? 'Explore map'}</Btn>
        </Link>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('explore')}>
          {actions.explore ?? 'Explore map'}
        </Btn>
      ) : null}
    </div>
  )
}
