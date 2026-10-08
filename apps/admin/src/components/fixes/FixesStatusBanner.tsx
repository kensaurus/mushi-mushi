/**
 * FILE: apps/admin/src/components/fixes/FixesStatusBanner.tsx
 * PURPOSE: Auto-fix pipeline posture — failed, inflight, no index, healthy.
 */

import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
import { fixesFailedAction, fixesFailedHint, fixesFailedTitle, scopedHref } from '../../lib/humanPageHints'
import type { FixesStats } from './FixesStatsTypes'

interface Props {
  stats: FixesStats
  /** "Rejected AI key (3), Sandbox timeout (1)", shown under the failed title. */
  causeSummary?: string
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function FixesStatusBanner({
  stats,
  causeSummary,
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
        title={fixesFailedTitle(stats.failed)}
        subtitle={`${stats.topPriorityLabel ?? fixesFailedHint(stats.failed)}${causeSummary ? ` Most common: ${causeSummary}.` : ''}`}
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
          'Agents are drafting branches and opening PRs — filter the list to In flight for live progress.'
        }
        action={
          <StatusBannerAction
            label={actions.pipeline ?? 'View in flight'}
            to={scopedHref('/fixes?status=inflight', pid)}
            tone="info"
          />
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
