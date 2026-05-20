/**
 * FILE: apps/admin/src/components/reports/ReportsStatusBanner.tsx
 * PURPOSE: Triage queue posture — ingest, backlog, critical, clear.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { ReportsStats, ReportsTabId } from './ReportsStatsTypes'

interface Props {
  stats: ReportsStats
  onTab?: (tab: ReportsTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
}

export function ReportsStatusBanner({ stats, onTab, onRefresh, refreshing }: Props) {
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No projects — reports inbox empty</p>
            <p className="text-2xs text-fg-muted">Create a project and install the SDK before user-felt bugs can land here.</p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">Go to Setup</Btn>
        </Link>
      </div>
    )
  }

  if (!stats.hasIngest) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">Waiting for first report on {projectLabel}</p>
            <p className="text-2xs text-fg-muted">
              SDK ingest must be live — send a test report from Setup to populate the triage queue.
            </p>
          </div>
        </div>
        <Link to="/onboarding?tab=verify">
          <Btn size="sm" variant="ghost">Send test report</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'critical') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.critical14d} critical report{stats.critical14d === 1 ? '' : 's'} in 14d
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">Triage critical</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('queue')}>
            Open queue
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'backlog') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.openBacklog} report{stats.openBacklog === 1 ? '' : 's'} stale &gt; 1h untriaged
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">Open backlog</Btn>
          </Link>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'untriaged') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {stats.newUntriaged} new report{stats.newUntriaged === 1 ? '' : 's'} awaiting triage
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.lastReportAt ? (
                <>Last ingest <RelativeTime value={stats.lastReportAt} /></>
              ) : (
                'Classifier scored severity — confirm before dispatching fixes.'
              )}
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('queue')}>
            Open queue
          </Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">Triage queue current on {projectLabel}</p>
          <p className="text-2xs text-fg-muted">
            {stats.total14d} reports in 14d
            {stats.lastReportAt ? (
              <> · last <RelativeTime value={stats.lastReportAt} /></>
            ) : null}
          </p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          Refresh
        </Btn>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('severity')}>
          Severity view
        </Btn>
      ) : null}
    </div>
  )
}
