/**
 * FILE: apps/admin/src/components/dashboard/DashboardStatusBanner.tsx
 * PURPOSE: Workspace posture — setup, backlog, failures, integrations, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create your first app to get started' : 'No projects yet'}
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Three quick steps: create a project, install the widget, send a test bug.'
            : 'Create a project on Setup before the dashboard can show intake, fixes, or loop health.')
        }
        action={
          <Link to={stats.topPriorityTo ?? '/onboarding'}>
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'setup') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `Setup ${stats.requiredComplete} of ${stats.requiredTotal} done on ${projectLabel}`
            : `Setup incomplete on ${projectLabel} (${stats.requiredComplete}/${stats.requiredTotal} required)`
        }
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Finish the checklist below — charts stay empty until a test bug arrives.'
            : 'Finish project, key, SDK, and first report — metrics stay gated until ingest is live.')
        }
        action={
          <Link to={stats.topPriorityTo ?? '/onboarding?tab=steps'}>
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Continue setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'backlog') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.openBacklog} bug${stats.openBacklog === 1 ? '' : 's'} waiting for you`
            : `${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} waiting > 1h to triage`
        }
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Open the oldest one first — send it to auto-fix when the proof looks right.'
            : stats.bottleneck ?? 'Plan stage is the bottleneck — users are waiting on classification.')
        }
        action={
          <Link to={stats.topPriorityTo ?? '/reports?tab=queue&status=new'}>
            <Btn size="sm" variant="ghost">{actions.triage ?? 'Review bugs'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'fixes_failed') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.fixesFailed} auto-fix${stats.fixesFailed === 1 ? '' : 'es'} need a retry`
            : `${stats.fixesFailed} auto-fix${stats.fixesFailed === 1 ? '' : 'es'} failed in 14d`
        }
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Open the failed fix, read the error, then retry or send to Cursor.'
            : 'Do stage needs attention — retry dispatch or inspect agent logs before the queue stalls.')
        }
        action={
          <Link to={stats.topPriorityTo ?? '/fixes?status=failed'}>
            <Btn size="sm" variant="ghost">{actions.failed ?? 'Retry fixes'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'integrations') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.integrationIssues} connection${stats.integrationIssues === 1 ? '' : 's'} need attention`
            : `${stats.integrationIssues} integration${stats.integrationIssues === 1 ? '' : 's'} failing probes`
        }
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'GitHub or webhooks may be misconfigured — fixes cannot land until this is green.'
            : 'Act stage degraded — fixes may not reach GitHub, Sentry, or webhooks until health recovers.')
        }
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('health')}>
              {actions.health ?? 'Check connections'}
            </Btn>
          ) : (
            <Link to={stats.topPriorityTo ?? '/integrations/config'}>
              <Btn size="sm" variant="ghost">{actions.health ?? 'Open integrations'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  if (stats.topPriority === 'waiting_data') {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Ready for your first bug' : 'Pipeline wired — waiting for first report'}
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Send a test bug from Setup — the dashboard fills in once ingest is live.'
            : 'Send a test report from Setup or wait for a real user bug — charts populate after ingest.')
        }
        action={
          <Link to={stats.topPriorityTo ?? '/onboarding?tab=verify'}>
            <Btn size="sm" variant="ghost">{actions.verify ?? 'Send test bug'}</Btn>
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
          ? `${projectLabel} looks healthy`
          : stats.projectCount > 1
            ? `${stats.projectCount} projects · loop healthy`
            : `${projectLabel} loop healthy`
      }
      subtitle={
        stats.topPriorityLabel ?? (
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
        )
      }
      action={
        onRefresh ? (
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
        ) : null
      }
    />
  )
}
