/**
 * FILE: apps/admin/src/components/repo/RepoStatusBanner.tsx
 * PURPOSE: Repo / branch pipeline posture — no repo, CI failing, stuck, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { RepoStats, RepoTabId } from './RepoStatsTypes'

interface Props {
  stats: RepoStats
  onTab?: (tab: RepoTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function RepoStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/repo')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create a project first' : 'No projects — repo graph idle'}
        subtitle={
          plainBanner
            ? 'Connect GitHub after setup so auto-fix branches appear here.'
            : 'Create a project and connect GitHub before branches appear here.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'no_repo') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'Connect your GitHub repo' : `No GitHub repo on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.connect ?? 'Connect repo'}</Btn>
            </Link>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'no_github_app') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Install the GitHub App' : 'GitHub App not installed'}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.install ?? 'Install app'}</Btn>
            </Link>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'stuck') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.failedToOpen} fix${stats.failedToOpen === 1 ? '' : 'es'} stuck without a PR`
            : `${stats.failedToOpen} stuck dispatch${stats.failedToOpen === 1 ? '' : 'es'} on ${projectLabel}`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.stuck ?? 'Review stuck'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('branches')}>
              {actions.stuck ?? 'Review stuck'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'ci_failing') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.ciFailed} branch${stats.ciFailed === 1 ? '' : 'es'} failing CI`
            : `${stats.ciFailed} branch${stats.ciFailed === 1 ? '' : 'es'} with failing CI`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.ci ?? 'Open failing CI'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('branches')}>
              {actions.ci ?? 'Open failing CI'}
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
        title="No fix branches yet"
        subtitle={stats.topPriorityLabel}
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
      title={plainBanner ? 'Repo looks healthy' : `Repo healthy on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.branches ?? 'View branches'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('branches')}>
            {actions.branches ?? 'View branches'}
          </Btn>
        ) : null
      }
    />
  )
}
