/**
 * FILE: apps/admin/src/components/intelligence/IntelligenceStatusBanner.tsx
 * PURPOSE: Weekly digest posture — locked, running, failed, stale, findings, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { IntelligenceStats, IntelligenceTabId } from './IntelligenceStatsTypes'

interface Props {
  stats: IntelligenceStats
  onTab?: (tab: IntelligenceTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  onGenerate?: () => void
  generating?: boolean
  plainBanner?: boolean
}

export function IntelligenceStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  onGenerate,
  generating,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/intelligence')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'Weekly summaries are per app — choose one in the header.'
            : 'Pick a project to generate weekly bug intelligence digests.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'feature_locked') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Weekly summaries need a paid plan' : 'Intelligence reports locked'}
        subtitle={stats.topPriorityLabel}
        action={
          <Link to="/billing">
            <Btn size="sm" variant="ghost">{actions.upgrade ?? 'Upgrade plan'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'job_running') {
    return (
      <StatusBannerShell
        tone="brand"
        pulseDot
        title={plainBanner ? 'Generating your weekly summary…' : `Digest generation running on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.pipeline ?? 'View pipeline'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('pipeline')}>{actions.pipeline ?? 'View pipeline'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'job_failed') {
    return (
      <StatusBannerShell
        tone="danger"
        title={plainBanner ? 'Last summary failed to generate' : 'Last digest generation failed'}
        subtitle={
          <span className="truncate max-w-prose" title={stats.lastJobError ?? undefined}>
            {stats.topPriorityLabel}
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            {onGenerate ? (
              <Btn size="sm" variant="primary" onClick={onGenerate} loading={generating} disabled={generating}>
                {actions.retry ?? 'Retry generation'}
              </Btn>
            ) : null}
            <Link to="/settings">
              <Btn size="sm" variant="ghost">{actions.settings ?? 'Check LLM keys'}</Btn>
            </Link>
          </div>
        }
      />
    )
  }

  if (stats.topPriority === 'no_reports') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No weekly summaries yet' : `No digests on ${projectLabel} yet`}
        subtitle={stats.topPriorityLabel}
        action={
          onGenerate ? (
            <Btn size="sm" variant="primary" onClick={onGenerate} loading={generating} disabled={generating}>
              {actions.generate ?? 'Generate this week'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'stale_digest') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `Summary is ${stats.daysSinceLastDigest} days old`
            : `Digest is ${stats.daysSinceLastDigest} days old`
        }
        subtitle={stats.topPriorityLabel}
        action={
          onGenerate ? (
            <Btn size="sm" variant="ghost" onClick={onGenerate} loading={generating} disabled={generating}>
              {actions.generate ?? 'Generate fresh digest'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'pending_findings') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.pendingFindings} upgrade suggestion${stats.pendingFindings === 1 ? '' : 's'} to review`
            : `${stats.pendingFindings} modernization finding${stats.pendingFindings === 1 ? '' : 's'} need triage`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.triage ?? 'Triage findings'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('pipeline')}>{actions.triage ?? 'Triage findings'}</Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Weekly summaries are up to date' : `Intelligence pipeline healthy on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.reports ?? 'View reports'}</Btn>
          </Link>
        ) : null
      }
    />
  )
}
