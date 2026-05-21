/**
 * FILE: apps/admin/src/components/drift/DriftStatusBanner.tsx
 * PURPOSE: Contract drift posture — never scanned, critical/warn findings, stale, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { DriftStats, DriftTabId } from './DriftStatsTypes'

interface Props {
  stats: DriftStats
  onTab?: (tab: DriftTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function DriftStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/drift')
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
                ? 'Contract checks are per app — choose one in the header.'
                : 'Pick a project to compare OpenAPI, inventory, and DB schema contracts.'}
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'critical_findings') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner
                ? `${stats.criticalOpen} critical contract gap${stats.criticalOpen === 1 ? '' : 's'}`
                : `${stats.criticalOpen} critical contract gap${stats.criticalOpen === 1 ? '' : 's'} on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.findings ?? 'Triage findings'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('findings')}>{actions.findings ?? 'Triage findings'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'warn_findings') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.warnOpen} warning-level drift{stats.warnOpen === 1 ? '' : 's'} open
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.review ?? 'Review findings'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('findings')}>{actions.review ?? 'Review findings'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'never_scanned') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner ? 'No contract snapshot yet' : `No contract snapshot on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.firstScan ?? 'Run first scan'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('scanner')}>{actions.firstScan ?? 'Run first scan'}</Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'stale_scan') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner ? 'Contract snapshot is stale' : `Contract snapshot is stale on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.scan ?? 'Run scan'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('scanner')}>{actions.scan ?? 'Run scan'}</Btn>
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
            {plainBanner ? 'Contracts in sync' : `Contracts in sync on ${projectLabel}`}
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
          <Btn size="sm" variant="ghost">{actions.snapshots ?? 'View snapshots'}</Btn>
        </Link>
      ) : null}
    </div>
  )
}
