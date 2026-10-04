/**
 * FILE: apps/admin/src/components/explore/ExploreStatusBanner.tsx
 * PURPOSE: Codebase atlas posture — indexing, errors, ready, stale.
 */

import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { ExploreStats, ExploreTabId } from './ExploreStatsTypes'
import { exploreActionLabelFor } from '../../lib/exploreTabNavigation'

interface Props {
  stats: ExploreStats
  onTab?: (tab: ExploreTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function ExploreStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/explore')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create a project first' : 'No projects — atlas empty'}
        subtitle={
          plainBanner
            ? 'Code indexing runs per app — set one up on Setup first.'
            : 'Create a project on Setup before indexing a codebase.'
        }
        action={
          <Btn to="/onboarding" size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        }
      />
    )
  }

  if (stats.topPriority === 'not_enabled') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'Code indexing is off' : `Indexing not enabled on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Btn to={stats.topPriorityTo} size="sm" variant="ghost">{actions.index ?? 'Open Index tab'}</Btn>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('index')}>
              {actions.index ?? 'Open Index tab'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'error') {
    return (
      <StatusBannerShell
        tone="danger"
        title={plainBanner ? 'Code index failed' : `Index error on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Btn to={stats.topPriorityTo} size="sm" variant="ghost">{actions.debug ?? 'Debug index'}</Btn>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('index')}>
              {actions.debug ?? 'Debug index'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'indexing') {
    return (
      <StatusBannerShell
        tone="info"
        pulseDot
        title={plainBanner ? 'Indexing your code…' : 'Indexing in progress'}
        subtitle={stats.topPriorityLabel}
        action={
          onRefresh ? (
            <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
              {actions.refresh ?? 'Refresh'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'empty') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'No code indexed yet' : `No files indexed on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          <Btn to="/settings" size="sm" variant="ghost">{actions.settings ?? 'Open Settings'}</Btn>
        }
      />
    )
  }

  if (stats.topPriority === 'stale') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Code map may be outdated' : 'Index may be stale'}
        subtitle={
          <>
            {stats.topPriorityLabel}
            {stats.lastIndexedAt ? (
              <> · last indexed <RelativeTime value={stats.lastIndexedAt} /></>
            ) : null}
          </>
        }
        action={
          stats.topPriorityTo ? (
            <Btn to={stats.topPriorityTo} size="sm" variant="ghost">{exploreActionLabelFor(stats.topPriorityTo)}</Btn>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('graph')}>
              {actions.graph ?? 'Open Graph'}
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Code map is ready' : `Atlas ready on ${projectLabel}`}
      subtitle={
        <>
          {stats.topPriorityLabel}
          {stats.lastIndexedAt ? (
            <> · indexed <RelativeTime value={stats.lastIndexedAt} /></>
          ) : null}
        </>
      }
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Btn to={stats.topPriorityTo} size="sm" variant="ghost">{exploreActionLabelFor(stats.topPriorityTo)}</Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('graph')}>
            {actions.graph ?? 'Open Graph'}
          </Btn>
        ) : null
      }
    />
  )
}
