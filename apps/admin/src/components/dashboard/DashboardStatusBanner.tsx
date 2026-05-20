/**
 * FILE: apps/admin/src/components/dashboard/DashboardStatusBanner.tsx
 * PURPOSE: Workspace PDCA posture — backlog, failures, setup, integrations.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { DashboardStats, DashboardTabId } from './DashboardStatsTypes'

interface Props {
  stats: DashboardStats
  onTab?: (tab: DashboardTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
}

export function DashboardStatusBanner({ stats, onTab, onRefresh, refreshing }: Props) {
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No projects yet</p>
            <p className="text-2xs text-fg-muted">
              Create a project on Setup before the dashboard can show intake, fixes, or loop health.
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">Go to Setup</Btn>
        </Link>
      </div>
    )
  }

  if (!stats.setupDone) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              Setup incomplete on {projectLabel} ({stats.requiredComplete}/{stats.requiredTotal} required)
            </p>
            <p className="text-2xs text-fg-muted">
              Finish project, key, SDK, and first report — the metrics below stay gated until ingest is live.
            </p>
          </div>
        </div>
        <Link to="/onboarding?tab=steps">
          <Btn size="sm" variant="ghost">Continue setup</Btn>
        </Link>
      </div>
    )
  }

  if (stats.openBacklog > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.openBacklog} report{stats.openBacklog === 1 ? '' : 's'} waiting &gt; 1h to triage
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.bottleneck ?? 'Plan stage is the bottleneck — users are waiting on classification.'}
            </p>
          </div>
        </div>
        <Link to="/reports?status=new">
          <Btn size="sm" variant="ghost">Open triage queue</Btn>
        </Link>
      </div>
    )
  }

  if (stats.fixesFailed > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.fixesFailed} auto-fix{stats.fixesFailed === 1 ? '' : 'es'} failed in 14d
            </p>
            <p className="text-2xs text-fg-muted">
              Do stage needs attention — retry dispatch or inspect agent logs before the queue stalls.
            </p>
          </div>
        </div>
        <Link to="/fixes?status=failed">
          <Btn size="sm" variant="ghost">View failed fixes</Btn>
        </Link>
      </div>
    )
  }

  if (stats.integrationIssues > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.integrationIssues} integration{stats.integrationIssues === 1 ? '' : 's'} failing probes
            </p>
            <p className="text-2xs text-fg-muted">
              Act stage degraded — fixes may not reach GitHub, Sentry, or webhooks until health recovers.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('health')}>
            View health
          </Btn>
        ) : (
          <Link to="/integrations/config">
            <Btn size="sm" variant="ghost">Open integrations</Btn>
          </Link>
        )}
      </div>
    )
  }

  if (!stats.hasData) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Pipeline wired — waiting for first report</p>
            <p className="text-2xs text-fg-muted">
              Send a test report from Setup or wait for a real user bug — charts populate after ingest.
            </p>
          </div>
        </div>
        <Link to="/onboarding?tab=verify">
          <Btn size="sm" variant="ghost">Send test report</Btn>
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
            {stats.projectCount > 1
              ? `${stats.projectCount} projects · loop healthy`
              : `${projectLabel} loop healthy`}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.reports14d} reports · {stats.fixesInProgress} fix{stats.fixesInProgress === 1 ? '' : 'es'} in flight
            {stats.lastActivityAt ? (
              <> · last activity <RelativeTime value={stats.lastActivityAt} /></>
            ) : null}
          </p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          Refresh
        </Btn>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('loop')}>
          View loop
        </Btn>
      ) : null}
    </div>
  )
}

