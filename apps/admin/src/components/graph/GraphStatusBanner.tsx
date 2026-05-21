/**
 * FILE: apps/admin/src/components/graph/GraphStatusBanner.tsx
 * PURPOSE: Knowledge graph posture — ingest, empty, fragile, regressions, clear.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create a project before the bug map can load' : 'No projects — graph empty'}
        subtitle={
          plainBanner
            ? 'The map fills in automatically once bugs start arriving.'
            : 'Create a project and ingest reports before the map can populate.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'waiting_ingest' || !stats.hasIngest) {
    return (
      <StatusBannerShell
        tone="brand"
        title={
          plainBanner ? `Waiting for the first bug on ${projectLabel}` : `Waiting for first report on ${projectLabel}`
        }
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Send a test bug — the map links it to screens and components.'
            : 'The graph seeds automatically as the classifier links reports to components and pages.')
        }
        action={
          <Link to={stats.topPriorityTo ?? '/onboarding?tab=verify'}>
            <Btn size="sm" variant="ghost">{actions.verify ?? 'Send test report'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'empty') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Bugs arrived but the map is still empty' : 'Graph empty despite ingest'}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.reports ?? 'Open Reports'}</Btn>
            </Link>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'fragile') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.fragileComponents} hotspot${stats.fragileComponents === 1 ? '' : 's'} — many bugs land here`
            : `${stats.fragileComponents} fragile component${stats.fragileComponents === 1 ? '' : 's'}`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.explore ?? 'Open map'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('explore')}>
              {actions.explore ?? 'Open map'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'regressions') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.regressionEdges} bug${stats.regressionEdges === 1 ? '' : 's'} came back after a fix`
            : `${stats.regressionEdges} regression edge${stats.regressionEdges === 1 ? '' : 's'}`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.regressions ?? 'View regressions'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('explore')}>
              {actions.regressions ?? 'View regressions'}
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? `Bug map is current on ${projectLabel}` : `Graph current on ${projectLabel}`}
      subtitle={
        stats.topPriorityLabel ?? (
          <>
            {stats.nodeCount} nodes · {stats.edgeCount} edges
            {stats.lastNodeAt ? (
              <>
                {' '}
                · last node <RelativeTime value={stats.lastNodeAt} />
              </>
            ) : null}
          </>
        )
      }
      action={
        onRefresh ? (
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
        ) : null
      }
    />
  )
}
