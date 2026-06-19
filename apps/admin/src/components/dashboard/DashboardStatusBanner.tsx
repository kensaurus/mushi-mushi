/**
 * FILE: apps/admin/src/components/dashboard/DashboardStatusBanner.tsx
 * PURPOSE: Workspace posture — setup, backlog, failures, integrations, healthy.
 */

import { RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
import {
  fixesFailedAction,
  fixesFailedHint,
  integrationIssuesHint,
  scopedHref,
  triageBacklogHint,
} from '../../lib/humanPageHints'
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
  const pid = stats.projectId

  if (stats.topPriority === 'no_project' || !stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create your first app to get started' : 'No projects yet'}
        subtitle={
          stats.topPriorityLabel ??
          'Create a project, install the widget, and send a test bug — then the dashboard shows your loop health.'
        }
        action={
          <StatusBannerAction
            label={actions.setup ?? 'Go to Setup'}
            to={stats.topPriorityTo ?? '/onboarding'}
            tone="info"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'setup') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`Setup ${stats.requiredComplete} of ${stats.requiredTotal} on ${projectLabel}`}
        subtitle={
          stats.topPriorityLabel ??
          'Finish project, API key, SDK install, and first report — charts stay empty until ingest is live.'
        }
        action={
          <StatusBannerAction
            label={actions.setup ?? 'Continue setup'}
            to={stats.topPriorityTo ?? scopedHref('/onboarding?tab=steps', pid)}
            tone="warn"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'backlog') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} waiting to triage`}
        subtitle={stats.topPriorityLabel ?? triageBacklogHint(stats.openBacklog)}
        action={
          <StatusBannerAction
            label={actions.triage ?? `Triage ${stats.openBacklog} reports`}
            to={stats.topPriorityTo ?? scopedHref('/reports?tab=queue&status=new', pid)}
            tone="danger"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'fixes_failed') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.fixesFailed} auto-fix${stats.fixesFailed === 1 ? '' : 'es'} failed`}
        subtitle={stats.topPriorityLabel ?? fixesFailedHint(stats.fixesFailed)}
        action={
          <StatusBannerAction
            label={actions.failed ?? fixesFailedAction(stats.fixesFailed)}
            to={stats.topPriorityTo ?? scopedHref('/fixes?status=failed', pid)}
            tone="danger"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'integrations') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.integrationIssues} integration${stats.integrationIssues === 1 ? '' : 's'} need attention`}
        subtitle={stats.topPriorityLabel ?? integrationIssuesHint(stats.integrationIssues)}
        action={
          onTab ? (
            <StatusBannerAction
              label={actions.health ?? 'Check connections'}
              onClick={() => onTab('health')}
              tone="warn"
            />
          ) : (
            <StatusBannerAction
              label={actions.health ?? 'Open integrations'}
              to={stats.topPriorityTo ?? scopedHref('/integrations/config', pid)}
              tone="warn"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'waiting_data') {
    return (
      <StatusBannerShell
        tone="info"
        title="Ready for your first bug report"
        subtitle={
          stats.topPriorityLabel ??
          'Send a test report from Setup — the dashboard fills in once ingest is live.'
        }
        action={
          <StatusBannerAction
            label={actions.verify ?? 'Send test report'}
            to={stats.topPriorityTo ?? scopedHref('/onboarding?tab=verify', pid)}
            tone="info"
          />
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={
        stats.projectCount > 1
          ? `${stats.projectCount} projects · loop healthy`
          : `${projectLabel} looks healthy`
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
          <StatusBannerAction
            label={actions.refresh ?? 'Refresh'}
            onClick={onRefresh}
            loading={refreshing}
            disabled={refreshing}
            tone="ok"
            emphasis="ghost"
          />
        ) : stats.topPriorityTo ? (
          <StatusBannerAction
            label={actions.healthy ?? 'View loop'}
            to={stats.topPriorityTo}
            tone="ok"
          />
        ) : onTab ? (
          <StatusBannerAction label={actions.healthy ?? 'View loop'} onClick={() => onTab('loop')} tone="ok" />
        ) : null
      }
    />
  )
}
