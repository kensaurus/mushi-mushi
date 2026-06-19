/**
 * FILE: apps/admin/src/components/qa-coverage/QaCoverageStatusBanner.tsx
 * PURPOSE: QA Coverage posture — no stories, failing, pending, idle, healthy.
 */

import { usePageCopy } from '../../lib/copy'
import { qaFailingHint, scopedHref } from '../../lib/humanPageHints'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
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
  const pid = stats.projectId

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
          <StatusBannerAction label={actions.setup ?? 'Go to Setup'} to="/onboarding" tone="info" />
        }
      />
    )
  }

  if (stats.topPriority === 'no_stories') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No automated tests yet' : `No QA stories on ${projectLabel}`}
        subtitle={
          stats.topPriorityLabel ??
          'Write a user-story test — it runs on a schedule and posts screenshots when it fails.'
        }
        action={
          onCreateStory ? (
            <StatusBannerAction
              label={actions.newStory ?? '+ New story'}
              onClick={onCreateStory}
              tone="brand"
            />
          ) : (
            <StatusBannerAction
              label={actions.create ?? 'Create story'}
              to={scopedHref('/qa-coverage?tab=overview', pid)}
              tone="brand"
            />
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
        subtitle={stats.topPriorityLabel ?? qaFailingHint(stats.failingStories)}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.failures ?? 'Review failing tests'}
              to={stats.topPriorityTo}
              tone="danger"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.failures ?? 'Review failing tests'}
              onClick={() => onTab('failing')}
              tone="danger"
            />
          ) : (
            <StatusBannerAction
              label={actions.failures ?? 'Review failing tests'}
              to={scopedHref('/qa-coverage?tab=failing', pid)}
              tone="danger"
            />
          )
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
        subtitle={
          stats.topPriorityLabel ??
          'Tests are running in the cloud — refresh or open Stories to watch progress.'
        }
        action={
          onTab ? (
            <StatusBannerAction
              label={actions.stories ?? 'View stories'}
              onClick={() => onTab('stories')}
              tone="brand"
            />
          ) : (
            <StatusBannerAction
              label={actions.stories ?? 'View stories'}
              to={scopedHref('/qa-coverage?tab=stories', pid)}
              tone="brand"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'no_runs' || stats.topPriority === 'disabled_all') {
    const disabled = stats.topPriority === 'disabled_all'
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? disabled
              ? 'All tests are turned off'
              : 'No test runs in the last 24 hours'
            : disabled
              ? 'All stories disabled'
              : 'No runs in the last 24h'
        }
        subtitle={
          stats.topPriorityLabel ??
          (disabled
            ? 'Re-enable at least one story so scheduled QA can catch regressions.'
            : 'Stories exist but nothing ran recently — check schedules or run one manually.')
        }
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.openStories ?? 'Open stories'}
              to={stats.topPriorityTo}
              tone="warn"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.openStories ?? 'Open stories'}
              onClick={() => onTab('stories')}
              tone="warn"
            />
          ) : (
            <StatusBannerAction
              label={actions.openStories ?? 'Open stories'}
              to={scopedHref('/qa-coverage?tab=stories', pid)}
              tone="warn"
            />
          )
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
          <StatusBannerAction
            label={actions.refresh ?? 'Refresh'}
            onClick={onRefresh}
            loading={refreshing}
            disabled={refreshing}
            tone="ok"
            emphasis="ghost"
          />
        ) : stats.topPriorityTo ? (
          <StatusBannerAction label={actions.stories ?? 'View stories'} to={stats.topPriorityTo} tone="ok" />
        ) : null
      }
    />
  )
}
