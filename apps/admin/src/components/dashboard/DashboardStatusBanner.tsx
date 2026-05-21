/**
 * FILE: apps/admin/src/components/dashboard/DashboardStatusBanner.tsx
 * PURPOSE: Workspace posture — setup, backlog, failures, integrations, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import type { DashboardStats, DashboardTabId } from './DashboardStatsTypes'

interface Props {
  stats: DashboardStats
  onTab?: (tab: DashboardTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function DashboardStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/dashboard')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (stats.topPriority === 'no_project' || !stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Create your first app to get started' : 'No projects yet'}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                (plainBanner
                  ? 'Three quick steps: create a project, install the widget, send a test bug.'
                  : 'Create a project on Setup before the dashboard can show intake, fixes, or loop health.')}
            </p>
          </div>
        </div>
        <Link to={stats.topPriorityTo ?? '/onboarding'}>
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'setup') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `Setup ${stats.requiredComplete} of ${stats.requiredTotal} done on ${projectLabel}`
                : `Setup incomplete on ${projectLabel} (${stats.requiredComplete}/${stats.requiredTotal} required)`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                (plainBanner
                  ? 'Finish the checklist below — charts stay empty until a test bug arrives.'
                  : 'Finish project, key, SDK, and first report — the metrics below stay gated until ingest is live.')}
            </p>
          </div>
        </div>
        <Link to={stats.topPriorityTo ?? '/onboarding?tab=steps'}>
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Continue setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'backlog') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner
                ? `${stats.openBacklog} bug${stats.openBacklog === 1 ? '' : 's'} waiting for you`
                : `${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} waiting > 1h to triage`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                (plainBanner
                  ? 'Open the oldest one first — send it to auto-fix when the proof looks right.'
                  : stats.bottleneck ?? 'Plan stage is the bottleneck — users are waiting on classification.')}
            </p>
          </div>
        </div>
        <Link to={stats.topPriorityTo ?? '/reports?tab=queue&status=new'}>
          <Btn size="sm" variant="ghost">{actions.triage ?? 'Review bugs'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'fixes_failed') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner
                ? `${stats.fixesFailed} auto-fix${stats.fixesFailed === 1 ? '' : 'es'} need a retry`
                : `${stats.fixesFailed} auto-fix${stats.fixesFailed === 1 ? '' : 'es'} failed in 14d`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                (plainBanner
                  ? 'Open the failed fix, read the error, then retry or send to Cursor.'
                  : 'Do stage needs attention — retry dispatch or inspect agent logs before the queue stalls.')}
            </p>
          </div>
        </div>
        <Link to={stats.topPriorityTo ?? '/fixes?status=failed'}>
          <Btn size="sm" variant="ghost">{actions.failed ?? 'Retry fixes'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'integrations') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `${stats.integrationIssues} connection${stats.integrationIssues === 1 ? '' : 's'} need attention`
                : `${stats.integrationIssues} integration${stats.integrationIssues === 1 ? '' : 's'} failing probes`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                (plainBanner
                  ? 'GitHub or webhooks may be misconfigured — fixes cannot land until this is green.'
                  : 'Act stage degraded — fixes may not reach GitHub, Sentry, or webhooks until health recovers.')}
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('health')}>
            {actions.health ?? 'Check connections'}
          </Btn>
        ) : (
          <Link to={stats.topPriorityTo ?? '/integrations/config'}>
            <Btn size="sm" variant="ghost">{actions.health ?? 'Open integrations'}</Btn>
          </Link>
        )}
      </div>
    )
  }

  if (stats.topPriority === 'waiting_data') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Ready for your first bug' : 'Pipeline wired — waiting for first report'}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel ??
                (plainBanner
                  ? 'Send a test bug from Setup — the dashboard fills in once ingest is live.'
                  : 'Send a test report from Setup or wait for a real user bug — charts populate after ingest.')}
            </p>
          </div>
        </div>
        <Link to={stats.topPriorityTo ?? '/onboarding?tab=verify'}>
          <Btn size="sm" variant="ghost">{actions.verify ?? 'Send test bug'}</Btn>
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
            {plainBanner
              ? `${projectLabel} looks healthy`
              : stats.projectCount > 1
                ? `${stats.projectCount} projects · loop healthy`
                : `${projectLabel} loop healthy`}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.topPriorityLabel ?? (
              <>
                {stats.reports14d} report{stats.reports14d === 1 ? '' : 's'} · {stats.fixesInProgress} fix
                {stats.fixesInProgress === 1 ? '' : 'es'} in flight
                {stats.lastActivityAt ? (
                  <>
                    {' '}
                    · last activity <RelativeTime value={stats.lastActivityAt} />
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          {actions.refresh ?? 'Refresh'}
        </Btn>
      ) : stats.topPriorityTo ? (
        <Link to={stats.topPriorityTo}>
          <Btn size="sm" variant="ghost">{actions.healthy ?? 'View loop'}</Btn>
        </Link>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('loop')}>
          {actions.healthy ?? 'View loop'}
        </Btn>
      ) : null}
    </div>
  )
}
