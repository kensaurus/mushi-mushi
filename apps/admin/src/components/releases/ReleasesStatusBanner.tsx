/**
 * FILE: apps/admin/src/components/releases/ReleasesStatusBanner.tsx
 * PURPOSE: Release pipeline posture — drafts pending, no fixes, empty, healthy history.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { ReleasesStats, ReleasesTabId } from './ReleasesStatsTypes'

interface Props {
  stats: ReleasesStats
  onTab?: (tab: ReleasesTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function ReleasesStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/releases')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'Pick an app before drafting changelogs or crediting reporters.'
            : 'Pick a project to draft changelogs and credit reporters.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'drafts_pending') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.draftCount} release draft${stats.draftCount === 1 ? '' : 's'} ready to publish`
            : `${stats.draftCount} draft release${stats.draftCount === 1 ? '' : 's'} waiting to publish`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.drafts ?? 'Review drafts'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('drafts')}>
              {actions.drafts ?? 'Review drafts'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'ready_to_draft') {
    return (
      <StatusBannerShell
        tone="brand"
        title={
          plainBanner
            ? `${stats.fixedReportsCount} fixed bug${stats.fixedReportsCount === 1 ? '' : 's'} ready to ship`
            : `${stats.fixedReportsCount} fixed report${stats.fixedReportsCount === 1 ? '' : 's'} ready to ship`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.draft ?? 'Generate draft'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('draft')}>
              {actions.draft ?? 'Generate draft'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'no_releases') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No releases yet' : `No releases on ${projectLabel} yet`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.draft ?? 'Generate draft'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('draft')}>
              {actions.draft ?? 'Generate draft'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'no_fixes') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No fixed bugs to draft from' : 'No fixed reports to draft from'}
        subtitle={stats.topPriorityLabel}
        action={
          <Link to="/reports?status=fixed">
            <Btn size="sm" variant="ghost">{actions.reports ?? 'View fixed reports'}</Btn>
          </Link>
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={
        plainBanner
          ? `${stats.publishedCount} release${stats.publishedCount === 1 ? '' : 's'} shipped`
          : `${stats.publishedCount} published release${stats.publishedCount === 1 ? '' : 's'} on ${projectLabel}`
      }
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.published ?? 'View published'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('published')}>
            {actions.published ?? 'View published'}
          </Btn>
        ) : null
      }
    />
  )
}
