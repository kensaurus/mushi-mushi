/**
 * FILE: apps/admin/src/components/research/ResearchStatusBanner.tsx
 * PURPOSE: Firecrawl research posture — BYOK setup, test failures, ready, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn, Badge } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'Web lookup is per app — choose one in the header.'
            : 'Pick a project to run Firecrawl web research during triage.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'firecrawl_not_configured') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Web search not set up' : `Firecrawl not configured on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          <Link to="/settings?tab=firecrawl">
            <Btn size="sm" variant="primary">{actions.configure ?? 'Configure Firecrawl'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'firecrawl_auth_failed' || stats.topPriority === 'firecrawl_error') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          stats.topPriority === 'firecrawl_auth_failed' ? 'Firecrawl auth failed' : 'Firecrawl connection error'
        }
        subtitle={stats.topPriorityLabel}
        action={
          <Link to="/settings?tab=firecrawl">
            <Btn size="sm" variant="ghost">{actions.fix ?? 'Fix in Settings'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'firecrawl_untested') {
    return (
      <StatusBannerShell
        tone="brand"
        title="Firecrawl key saved — test required"
        subtitle={stats.topPriorityLabel}
        action={
          <Link to="/settings?tab=firecrawl">
            <Btn size="sm" variant="ghost">{actions.test ?? 'Test connection'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'ready_no_sessions') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'Ready for your first search' : `Firecrawl ready on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          onTab ? (
            <Btn size="sm" variant="primary" onClick={() => onTab('search')}>{actions.search ?? 'Run first search'}</Btn>
          ) : (
            <Link to="/research?tab=search">
              <Btn size="sm" variant="primary">{actions.search ?? 'Run first search'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  if (stats.topPriority === 'unattached_snippets') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.unattachedSnippets} snippet${stats.unattachedSnippets === 1 ? '' : 's'} awaiting attach`}
        subtitle={stats.topPriorityLabel}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('search')}>{actions.attach ?? 'Attach evidence'}</Btn>
          ) : (
            <Link to="/research?tab=search">
              <Btn size="sm" variant="ghost">{actions.attach ?? 'Attach evidence'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={
        <>
          {plainBanner ? 'Research pipeline healthy' : `Research pipeline healthy on ${projectLabel}`}
          {stats.firecrawlKeyHint && !plainBanner ? (
            <Badge className="ml-2 bg-surface-raised font-mono text-fg-secondary">{stats.firecrawlKeyHint}</Badge>
          ) : null}
        </>
      }
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.history ?? 'View history'}</Btn>
          </Link>
        ) : null
      }
    />
  )
}
