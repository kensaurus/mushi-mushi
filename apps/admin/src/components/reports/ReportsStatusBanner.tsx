/**
 * FILE: apps/admin/src/components/reports/ReportsStatusBanner.tsx
 * PURPOSE: Triage queue posture — ingest, backlog, critical, clear.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { ReportsStats, ReportsTabId } from './ReportsStatsTypes'

interface Props {
  stats: ReportsStats
  onTab?: (tab: ReportsTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function ReportsStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/reports')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Create a project first' : 'No projects — reports inbox empty'}
            </p>
            <p className="text-2xs text-fg-muted">
              {plainBanner
                ? 'Install the widget after you create an app — bugs land here automatically.'
                : 'Create a project and install the SDK before user-felt bugs can land here.'}
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
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
            <p className="text-xs font-medium text-brand">
              {plainBanner
                ? 'Waiting for your first bug report'
                : `Waiting for first report on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                (plainBanner
                  ? 'Send a test bug from Setup to confirm the widget is working.'
                  : 'SDK ingest must be live — send a test report from Setup to populate the triage queue.')}
            </p>
          </div>
        </div>
        <Link to={stats.topPriorityTo ?? '/onboarding?tab=verify'}>
          <Btn size="sm" variant="ghost">{actions.verify ?? 'Send test report'}</Btn>
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
              {plainBanner
                ? `${stats.critical14d} critical bug${stats.critical14d === 1 ? '' : 's'} need review`
                : `${stats.critical14d} critical report${stats.critical14d === 1 ? '' : 's'} in 14d`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.triage ?? 'Triage critical'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('queue')}>
            {actions.queue ?? 'Open queue'}
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
              {plainBanner
                ? `${stats.openBacklog} bug${stats.openBacklog === 1 ? '' : 's'} waiting over an hour`
                : `${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} stale > 1h untriaged`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.backlog ?? 'Open backlog'}</Btn>
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
              {plainBanner
                ? `${stats.newUntriaged} new bug${stats.newUntriaged === 1 ? '' : 's'} to review`
                : `${stats.newUntriaged} new report${stats.newUntriaged === 1 ? '' : 's'} awaiting triage`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.lastReportAt ? (
                <>
                  Last ingest <RelativeTime value={stats.lastReportAt} />
                </>
              ) : (
                stats.topPriorityLabel ??
                  (plainBanner
                    ? 'Confirm severity before sending to auto-fix.'
                    : 'Classifier scored severity — confirm before dispatching fixes.')
              )}
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('queue')}>
            {actions.queue ?? 'Open queue'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.queue ?? 'Open queue'}</Btn>
          </Link>
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
            {plainBanner
              ? 'Bug queue is up to date'
              : `Triage queue current on ${projectLabel}`}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.topPriorityLabel ??
              `${stats.total14d} reports in 14d${
                stats.lastReportAt ? '' : ''
              }`}
            {stats.lastReportAt ? (
              <>
                {' '}
                · last <RelativeTime value={stats.lastReportAt} />
              </>
            ) : null}
          </p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          {actions.refresh ?? 'Refresh'}
        </Btn>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('severity')}>
          {actions.severity ?? 'Severity view'}
        </Btn>
      ) : null}
    </div>
  )
}
