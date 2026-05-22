/**
 * FILE: apps/admin/src/components/qa-coverage/QaCoverageStatusBanner.tsx
 * PURPOSE: QA Coverage posture — no stories, failing, pending, idle, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'QA tests run per app — choose one in the header.'
            : 'Pick a project to manage QA stories and scheduled runs.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'no_stories') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No automated tests yet' : `No QA stories on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          onCreateStory ? (
            <Btn size="sm" variant="ghost" onClick={onCreateStory}>{actions.newStory ?? '+ New story'}</Btn>
          ) : (
            <Link to="/qa-coverage?tab=overview">
              <Btn size="sm" variant="ghost">{actions.create ?? 'Create story'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  if (stats.topPriority === 'failing') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.failingStories} test${stats.failingStories === 1 ? '' : 's'} failing`
            : `${stats.failingStories} failing stor${stats.failingStories === 1 ? 'y' : 'ies'} (24h)`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.failures ?? 'Review failures'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('failing')}>{actions.failures ?? 'Review failures'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'pending') {
    return (
      <StatusBannerShell
        tone="brand"
        pulseDot
        title={
          plainBanner
            ? `${stats.pendingRuns} test run${stats.pendingRuns === 1 ? '' : 's'} in progress`
            : `${stats.pendingRuns} run${stats.pendingRuns === 1 ? '' : 's'} in flight`
        }
        subtitle={stats.topPriorityLabel}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('stories')}>{actions.stories ?? 'View stories'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'no_runs' || stats.topPriority === 'disabled_all') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? stats.topPriority === 'disabled_all'
              ? 'All tests are turned off'
              : 'No test runs in the last 24 hours'
            : stats.topPriority === 'disabled_all'
              ? 'All stories disabled'
              : 'No runs in the last 24h'
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.openStories ?? 'Open stories'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('stories')}>{actions.openStories ?? 'Open stories'}</Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Automated QA is healthy' : `QA coverage healthy on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.stories ?? 'View stories'}</Btn>
          </Link>
        ) : null
      }
    />
  )
}
