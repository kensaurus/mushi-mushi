/**
 * FILE: apps/admin/src/components/repo/RepoStatusBanner.tsx
 * PURPOSE: Repo / branch pipeline posture — no repo, CI failing, stuck, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
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
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Create a project first' : 'No projects — repo graph idle'}
            </p>
            <p className="text-2xs text-fg-muted">
              {plainBanner
                ? 'Connect GitHub after setup so auto-fix branches appear here.'
                : 'Create a project and connect GitHub before branches appear here.'}
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'no_repo') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? 'Connect your GitHub repo' : `No GitHub repo on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.connect ?? 'Connect repo'}</Btn>
          </Link>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'no_github_app') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner ? 'Install the GitHub App' : 'GitHub App not installed'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.install ?? 'Install app'}</Btn>
          </Link>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'stuck') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner
                ? `${stats.failedToOpen} fix${stats.failedToOpen === 1 ? '' : 'es'} stuck without a PR`
                : `${stats.failedToOpen} stuck dispatch${stats.failedToOpen === 1 ? '' : 'es'} on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.stuck ?? 'Review stuck'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('branches')}>
            {actions.stuck ?? 'Review stuck'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'ci_failing') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `${stats.ciFailed} branch${stats.ciFailed === 1 ? '' : 'es'} failing CI`
                : `${stats.ciFailed} branch${stats.ciFailed === 1 ? '' : 'es'} with failing CI`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.ci ?? 'Open failing CI'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('branches')}>
            {actions.ci ?? 'Open failing CI'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'waiting') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? 'No fix branches yet' : 'No fix branches yet'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        <Link to="/reports">
          <Btn size="sm" variant="ghost">{actions.reports ?? 'Open Reports'}</Btn>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {plainBanner ? 'Repo looks healthy' : `Repo healthy on ${projectLabel}`}
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
          <Btn size="sm" variant="ghost">{actions.branches ?? 'View branches'}</Btn>
        </Link>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('branches')}>
          {actions.branches ?? 'View branches'}
        </Btn>
      ) : null}
    </div>
  )
}
