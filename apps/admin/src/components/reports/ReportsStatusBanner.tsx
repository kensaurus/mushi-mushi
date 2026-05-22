/**
 * FILE: apps/admin/src/components/reports/ReportsStatusBanner.tsx
 * PURPOSE: Triage queue posture — ingest, backlog, critical, clear.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create a project first' : 'No projects — reports inbox empty'}
        subtitle={
          plainBanner
            ? 'Install the widget after you create an app — bugs land here automatically.'
            : 'Create a project and install the SDK before user-felt bugs can land here.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
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
          <Link to={stats.topPriorityTo ?? '/onboarding?tab=verify'}>
            <Btn size="sm" variant="ghost">{actions.verify ?? 'Send test report'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'critical') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.critical14d} critical bug${stats.critical14d === 1 ? '' : 's'} need review`
            : `${stats.critical14d} critical report${stats.critical14d === 1 ? '' : 's'} in 14d`
        }
        subtitle={stats.topPriorityLabel ?? 'Confirm severity and dispatch fixes before they spread.'}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.triage ?? 'Triage critical'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('queue')}>
              {actions.queue ?? 'Open queue'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'backlog') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.openBacklog} bug${stats.openBacklog === 1 ? '' : 's'} waiting over an hour`
            : `${stats.openBacklog} report${stats.openBacklog === 1 ? '' : 's'} stale > 1h untriaged`
        }
        subtitle={stats.topPriorityLabel ?? 'Stale reports lose context — triage or dismiss to keep the queue honest.'}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.backlog ?? 'Open backlog'}</Btn>
            </Link>
          ) : null
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
            <Btn size="sm" variant="ghost" onClick={() => onTab('queue')}>
              {actions.queue ?? 'Open queue'}
            </Btn>
          ) : stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.queue ?? 'Open queue'}</Btn>
            </Link>
          ) : null
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
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('severity')}>
            {actions.severity ?? 'Severity view'}
          </Btn>
        ) : null
      }
    />
  )
}
