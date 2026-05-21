/**
 * FILE: apps/admin/src/components/fixes/FixesStatusBanner.tsx
 * PURPOSE: Auto-fix pipeline posture — failed, inflight, no index, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
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
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/fixes')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create a project first' : 'No projects — fix pipeline idle'}
        subtitle={
          plainBanner
            ? 'Connect GitHub after setup so auto-fix can open draft PRs.'
            : 'Create a project and connect GitHub before dispatching fixes.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'no_github') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'Connect GitHub to open PRs' : `GitHub not connected on ${projectLabel}`}
        subtitle={stats.topPriorityLabel ?? 'Auto-fix needs a repo to branch from and open draft PRs.'}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.github ?? 'Connect repo'}</Btn>
            </Link>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'no_index') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Index your codebase first' : 'Codebase not indexed — stub PR risk'}
        subtitle={stats.topPriorityLabel ?? 'Enable codebase indexing so the agent reads real files before patching.'}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.index ?? 'Enable indexing'}</Btn>
            </Link>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'failed') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.failed} fix${stats.failed === 1 ? '' : 'es'} need attention`
            : `${stats.failed} failed fix${stats.failed === 1 ? '' : 'es'} on ${projectLabel}`
        }
        subtitle={stats.topPriorityLabel ?? 'Review failure categories and retry or hand off to Cursor.'}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.failed ?? 'Review failed'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('attempts')}>
              {actions.failed ?? 'Review failed'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'inflight') {
    return (
      <StatusBannerShell
        tone="info"
        pulseDot
        title={plainBanner ? 'Fixes running now' : 'Fixes in flight'}
        subtitle={stats.topPriorityLabel ?? 'Agents are drafting branches and opening PRs — timeline updates live.'}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.pipeline ?? 'Open pipeline'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('pipeline')}>
              {actions.pipeline ?? 'Open pipeline'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'waiting') {
    return (
      <StatusBannerShell
        tone="brand"
        title="No fix attempts yet"
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Send a bug from Reports to draft your first pull request.'
            : 'Dispatch a classified report to start the auto-fix loop.')
        }
        action={
          <Link to="/reports">
            <Btn size="sm" variant="ghost">{actions.reports ?? 'Open Reports'}</Btn>
          </Link>
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Fix pipeline looks healthy' : `Pipeline healthy on ${projectLabel}`}
      subtitle={stats.topPriorityLabel ?? 'Recent attempts completed or are waiting on your merge review.'}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.attempts ?? 'View attempts'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('attempts')}>
            {actions.attempts ?? 'View attempts'}
          </Btn>
        ) : null
      }
    />
  )
}
