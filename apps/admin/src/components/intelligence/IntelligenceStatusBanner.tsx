/**
 * FILE: apps/admin/src/components/intelligence/IntelligenceStatusBanner.tsx
 * PURPOSE: Weekly digest posture — locked, running, failed, stale, findings, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
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
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Pick a project first' : 'No project selected'}
            </p>
            <p className="text-2xs text-fg-muted">
              {plainBanner
                ? 'Weekly summaries are per app — choose one in the header.'
                : 'Pick a project to generate weekly bug intelligence digests.'}
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'feature_locked') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner ? 'Weekly summaries need a paid plan' : 'Intelligence reports locked'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        <Link to="/billing">
          <Btn size="sm" variant="ghost">{actions.upgrade ?? 'Upgrade plan'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'job_running') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand motion-safe:animate-pulse" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? 'Generating your weekly summary…' : `Digest generation running on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.pipeline ?? 'View pipeline'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('pipeline')}>{actions.pipeline ?? 'View pipeline'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'job_failed') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner ? 'Last summary failed to generate' : 'Last digest generation failed'}
            </p>
            <p className="text-2xs text-fg-muted truncate max-w-prose" title={stats.lastJobError ?? undefined}>
              {stats.topPriorityLabel}
            </p>
          </div>
        </div>
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
      </div>
    )
  }

  if (stats.topPriority === 'no_reports') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? 'No weekly summaries yet' : `No digests on ${projectLabel} yet`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onGenerate ? (
          <Btn size="sm" variant="primary" onClick={onGenerate} loading={generating} disabled={generating}>
            {actions.generate ?? 'Generate this week'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'stale_digest') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `Summary is ${stats.daysSinceLastDigest} days old`
                : `Digest is ${stats.daysSinceLastDigest} days old`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onGenerate ? (
          <Btn size="sm" variant="ghost" onClick={onGenerate} loading={generating} disabled={generating}>
            {actions.generate ?? 'Generate fresh digest'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'pending_findings') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `${stats.pendingFindings} upgrade suggestion${stats.pendingFindings === 1 ? '' : 's'} to review`
                : `${stats.pendingFindings} modernization finding${stats.pendingFindings === 1 ? '' : 's'} need triage`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.triage ?? 'Triage findings'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('pipeline')}>{actions.triage ?? 'Triage findings'}</Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {plainBanner ? 'Weekly summaries are up to date' : `Intelligence pipeline healthy on ${projectLabel}`}
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
          <Btn size="sm" variant="ghost">{actions.reports ?? 'View reports'}</Btn>
        </Link>
      ) : null}
    </div>
  )
}
