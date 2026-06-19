/**
 * FILE: apps/admin/src/components/reports/ReportsStatusBanner.tsx
 * PURPOSE: Triage queue posture — ingest, backlog, critical, clear.
 */

import { RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
import { scopedHref, triageBacklogHint } from '../../lib/humanPageHints'
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
  const pid = stats.projectId

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create a project first' : 'No projects — reports inbox empty'}
        subtitle={
          plainBanner
            ? 'Install the widget after you create an app — bugs land here automatically.'
            : 'Create a project and install the SDK before user-felt bugs can land here.'
        }
        action={
          <StatusBannerAction label={actions.setup ?? 'Go to Setup'} to="/onboarding" tone="info" />
        }
      />
    )
  }

  if (!stats.hasIngest) {
    return (
      <StatusBannerShell
        tone="brand"
        title={
          plainBanner
            ? 'Waiting for your first bug report'
            : `Waiting for first report on ${projectLabel}`
        }
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Send a test bug from Setup to confirm the widget is working.'
            : 'SDK ingest must be live — send a test report from Setup to populate the triage queue.')
        }
        action={
          <StatusBannerAction
            label={actions.verify ?? 'Send test report'}
            to={stats.topPriorityTo ?? scopedHref('/onboarding?tab=verify', pid)}
            tone="brand"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'critical') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.critical14d} critical bug${stats.critical14d === 1 ? '' : 's'} need review`}
        subtitle={
          stats.topPriorityLabel ??
          'Critical bugs block user workflows — confirm severity and dispatch fixes first.'
        }
        action={
          <StatusBannerAction
            label={actions.triage ?? `Review ${stats.critical14d} critical`}
            to={stats.topPriorityTo ?? scopedHref('/reports?tab=queue&severity=critical', pid)}
            tone="danger"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'backlog') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} waiting to triage`}
        subtitle={stats.topPriorityLabel ?? triageBacklogHint(stats.openBacklog)}
        action={
          <StatusBannerAction
            label={actions.backlog ?? `Triage ${stats.openBacklog} waiting`}
            to={stats.topPriorityTo ?? scopedHref('/reports?tab=queue&status=new', pid)}
            tone="warn"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'untriaged') {
    return (
      <StatusBannerShell
        tone="info"
        title={
          plainBanner
            ? `${stats.newUntriaged} new bug${stats.newUntriaged === 1 ? '' : 's'} to review`
            : `${stats.newUntriaged} new report${stats.newUntriaged === 1 ? '' : 's'} awaiting triage`
        }
        subtitle={
          stats.lastReportAt ? (
            <>
              Last ingest <RelativeTime value={stats.lastReportAt} />
            </>
          ) : (
            stats.topPriorityLabel ??
            (plainBanner
              ? 'Confirm severity before sending to auto-fix.'
              : 'Classifier scored severity — confirm before dispatching fixes.')
          )
        }
        action={
          onTab ? (
            <StatusBannerAction
              label={actions.queue ?? 'Open queue'}
              onClick={() => onTab('queue')}
              tone="info"
            />
          ) : (
            <StatusBannerAction
              label={actions.queue ?? 'Open queue'}
              to={stats.topPriorityTo ?? scopedHref('/reports?tab=queue', pid)}
              tone="info"
            />
          )
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Bug queue is up to date' : `Triage queue current on ${projectLabel}`}
      subtitle={
        <>
          {stats.topPriorityLabel ?? `${stats.total14d} reports in 14d`}
          {stats.lastReportAt ? (
            <>
              {' '}
              · last <RelativeTime value={stats.lastReportAt} />
            </>
          ) : null}
        </>
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
        ) : onTab ? (
          <StatusBannerAction
            label={actions.severity ?? 'Severity view'}
            onClick={() => onTab('severity')}
            tone="ok"
          />
        ) : null
      }
    />
  )
}
