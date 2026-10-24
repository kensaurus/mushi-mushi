/**
 * FILE: apps/admin/src/components/reports/ReportsStatusBanner.tsx
 * PURPOSE: Triage queue posture — ingest, backlog, critical, clear.
 *          `ReportsStatusBannerReserve` holds that box while stats load.
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

/** Same box as StatusBannerShell (title, subtitle, sm button) before stats land. */
export function ReportsStatusBannerReserve() {
  return (
    <div
      aria-hidden="true"
      data-testid="reports-status-reserve"
      className="flex flex-col gap-3 rounded-md border border-transparent px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" />
        <div className="min-w-0 space-y-1">
          <p className="invisible text-xs font-medium">12 reports waiting for review</p>
          <p className="invisible text-2xs">
            Critical bugs block user workflows — confirm severity and dispatch fixes first.
          </p>
        </div>
      </div>
      <span className="inline-flex min-h-6 w-36 shrink-0" />
    </div>
  )
}

/** Same box as RecommendedAction while the report list is still loading. */
export function ReportsRecommendationReserve() {
  return (
    <div
      aria-hidden="true"
      data-testid="reports-recommendation-reserve"
      className="mb-3 flex items-start gap-3 rounded-md border border-transparent p-3"
    >
      <span className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="invisible text-sm font-medium leading-tight">3 critical reports need triage</p>
        <p className="invisible mt-1 text-xs leading-relaxed">
          High-severity reports are still pending. Open them to confirm classification and dispatch a fix.
        </p>
      </div>
      <span className="inline-flex min-h-6 w-40 shrink-0" />
    </div>
  )
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
            : 'Send a test report from Setup to fill the bug queue.')
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
        // No count from an API that predates criticalUntriaged14d: the old
        // critical14d also counted fixed and dismissed reports.
        title={
          stats.criticalUntriaged14d != null
            ? `${stats.criticalUntriaged14d} critical bug${stats.criticalUntriaged14d === 1 ? '' : 's'} need review`
            : 'Critical bugs need review'
        }
        subtitle={
          stats.topPriorityLabel ??
          'Critical bugs block user workflows — confirm severity and dispatch fixes first.'
        }
        action={
          <StatusBannerAction
            label={actions.triage ?? (stats.criticalUntriaged14d != null ? `Review ${stats.criticalUntriaged14d} critical` : 'Review critical')}
            to={stats.topPriorityTo ?? scopedHref('/reports?status=new&severity=critical&days=14', pid)}
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
        title={`${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} waiting for review`}
        subtitle={stats.topPriorityLabel ?? triageBacklogHint(stats.openBacklog)}
        action={
          <StatusBannerAction
            label={actions.backlog ?? `Review ${stats.openBacklog} waiting`}
            to={stats.topPriorityTo ?? scopedHref('/reports?status=new&sort=created_at&dir=asc', pid)}
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
              to={stats.topPriorityTo ?? scopedHref('/reports?status=new', pid)}
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
      title={plainBanner ? 'Bug queue is up to date' : `Bug queue current on ${projectLabel}`}
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
