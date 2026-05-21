/**
 * FILE: apps/admin/src/components/research/ResearchStatusBanner.tsx
 * PURPOSE: Firecrawl research posture — BYOK setup, test failures, ready, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn, Badge } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { ResearchStats, ResearchTabId } from './ResearchStatsTypes'

interface Props {
  stats: ResearchStats
  onTab?: (tab: ResearchTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function ResearchStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/research')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Pick a project first' : 'No project selected'}
            </p>
            <p className="text-2xs text-fg-muted">
              {plainBanner
                ? 'Web lookup is per app — choose one in the header.'
                : 'Pick a project to run Firecrawl web research during triage.'}
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'firecrawl_not_configured') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner ? 'Web search not set up' : `Firecrawl not configured on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        <Link to="/settings?tab=firecrawl">
          <Btn size="sm" variant="primary">{actions.configure ?? 'Configure Firecrawl'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'firecrawl_auth_failed' || stats.topPriority === 'firecrawl_error') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.topPriority === 'firecrawl_auth_failed' ? 'Firecrawl auth failed' : 'Firecrawl connection error'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        <Link to="/settings?tab=firecrawl">
          <Btn size="sm" variant="ghost">{actions.fix ?? 'Fix in Settings'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'firecrawl_untested') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">Firecrawl key saved — test required</p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        <Link to="/settings?tab=firecrawl">
          <Btn size="sm" variant="ghost">{actions.test ?? 'Test connection'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'ready_no_sessions') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? 'Ready for your first search' : `Firecrawl ready on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="primary" onClick={() => onTab('search')}>{actions.search ?? 'Run first search'}</Btn>
        ) : (
          <Link to="/research?tab=search">
            <Btn size="sm" variant="primary">{actions.search ?? 'Run first search'}</Btn>
          </Link>
        )}
      </div>
    )
  }

  if (stats.topPriority === 'unattached_snippets') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.unattachedSnippets} snippet{stats.unattachedSnippets === 1 ? '' : 's'} awaiting attach
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('search')}>{actions.attach ?? 'Attach evidence'}</Btn>
        ) : (
          <Link to="/research?tab=search">
            <Btn size="sm" variant="ghost">{actions.attach ?? 'Attach evidence'}</Btn>
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <p className="text-xs font-medium text-ok">
          {plainBanner ? 'Research pipeline healthy' : `Research pipeline healthy on ${projectLabel}`}
        </p>
        {stats.firecrawlKeyHint && !plainBanner && (
          <Badge className="bg-surface-raised font-mono text-fg-secondary">{stats.firecrawlKeyHint}</Badge>
        )}
        <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          {actions.refresh ?? 'Refresh'}
        </Btn>
      ) : stats.topPriorityTo ? (
        <Link to={stats.topPriorityTo}>
          <Btn size="sm" variant="ghost">{actions.history ?? 'View history'}</Btn>
        </Link>
      ) : null}
    </div>
  )
}
