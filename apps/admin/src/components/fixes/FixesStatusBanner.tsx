/**
 * FILE: apps/admin/src/components/fixes/FixesStatusBanner.tsx
 * PURPOSE: Auto-fix pipeline posture — failed, inflight, no index, healthy.
 */

import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
import { fixesFailedAction, fixesFailedHint, scopedHref } from '../../lib/humanPageHints'
import type { FixesStats, FixesTabId } from './FixesStatsTypes'

interface Props {
  stats: FixesStats
  onTab?: (tab: FixesTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function FixesStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  plainBanner: _plainBanner = false,
}: Props) {
  const copy = usePageCopy('/fixes')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'
  const pid = stats.projectId

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title="Create a project first"
        subtitle="Connect GitHub after setup so auto-fix can open draft PRs."
        action={<StatusBannerAction label={actions.setup ?? 'Go to Setup'} to="/onboarding" tone="info" />}
      />
    )
  }

  if (stats.topPriority === 'no_github') {
    return (
      <StatusBannerShell
        tone="brand"
        title={`Connect GitHub on ${projectLabel}`}
        subtitle={
          stats.topPriorityLabel ??
          'Auto-fix needs a connected repo to branch from and open draft pull requests.'
        }
        action={
          <StatusBannerAction
            label={actions.github ?? 'Connect GitHub'}
            to={stats.topPriorityTo ?? scopedHref('/integrations/config', pid)}
            tone="brand"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'no_index') {
    return (
      <StatusBannerShell
        tone="warn"
        title="Index your codebase first"
        subtitle={
          stats.topPriorityLabel ??
          'Enable codebase indexing so the agent reads real files before proposing patches.'
        }
        action={
          <StatusBannerAction
            label={actions.index ?? 'Enable indexing'}
            to={stats.topPriorityTo ?? scopedHref('/integrations/config', pid)}
            tone="warn"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'failed') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.failed} auto-fix${stats.failed === 1 ? '' : 'es'} failed`}
        subtitle={stats.topPriorityLabel ?? fixesFailedHint(stats.failed)}
        action={
          <StatusBannerAction
            label={actions.failed ?? fixesFailedAction(stats.failed)}
            to={stats.topPriorityTo ?? scopedHref('/fixes?status=failed', pid)}
            tone="danger"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'inflight') {
    return (
      <StatusBannerShell
        tone="info"
        pulseDot
        title={`${stats.inProgress} fix${stats.inProgress === 1 ? '' : 'es'} running now`}
        subtitle={
          stats.topPriorityLabel ??
          'Agents are drafting branches and opening PRs — check the pipeline tab for live progress.'
        }
        action={
          onTab ? (
            <StatusBannerAction label={actions.pipeline ?? 'Open pipeline'} onClick={() => onTab('pipeline')} tone="info" />
          ) : (
            <StatusBannerAction
              label={actions.pipeline ?? 'Open pipeline'}
              to={stats.topPriorityTo ?? scopedHref('/fixes?status=running', pid)}
              tone="info"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'waiting') {
    const hasAttempts = stats.totalAttempts > 0
    return (
      <StatusBannerShell
        tone="brand"
        title={hasAttempts ? `${stats.totalAttempts} fix attempts on record` : 'No fix attempts yet'}
        subtitle={
          stats.topPriorityLabel ??
          (hasAttempts
            ? 'Nothing is running right now — review past attempts or send a new report to the pipeline.'
            : 'Send a classified bug from Reports to draft your first pull request.')
        }
        action={
          <StatusBannerAction label={actions.reports ?? 'Open Reports'} to={scopedHref('/reports', pid)} tone="brand" />
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`Fix pipeline healthy on ${projectLabel}`}
      subtitle={stats.topPriorityLabel ?? 'Recent attempts completed or are waiting on your merge review.'}
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
        ) : (
          <StatusBannerAction
            label={actions.attempts ?? 'View attempts'}
            to={stats.topPriorityTo ?? scopedHref('/fixes', pid)}
            tone="ok"
          />
        )
      }
    />
  )
}
