/**
 * FILE: apps/admin/src/components/inbox/InboxStatusBanner.tsx
 * PURPOSE: Action inbox posture — open work, setup gaps, all-clear state.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { InboxStats, InboxTabId } from './types'

interface Props {
  stats: InboxStats
  onTab?: (tab: InboxTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
}

export function InboxStatusBanner({ stats, onTab, onRefresh, refreshing }: Props) {
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No projects — inbox is empty</p>
            <p className="text-2xs text-fg-muted">
              Create a project on Setup first. Actions appear here once reports and integrations are wired.
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
              Setup incomplete on {projectLabel} ({stats.requiredComplete}/{stats.requiredTotal})
            </p>
            <p className="text-2xs text-fg-muted">
              Finish ingest before the inbox can surface real triage and fix actions.
            </p>
          </div>
        </div>
        <Link to="/onboarding?tab=steps">
          <Btn size="sm" variant="ghost">Continue setup</Btn>
        </Link>
      </div>
    )
  }

  if (stats.openActions > 0 && stats.topPriorityTitle && stats.topPriorityTo) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.openActions} open action{stats.openActions === 1 ? '' : 's'} — start with {stats.topPriorityStage ?? 'Plan'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityTitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('actions')}>
              View queue
            </Btn>
          ) : null}
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">Take action</Btn>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            Inbox zero — {stats.clearStages}/{stats.totalSurfaces} stages clear
          </p>
          <p className="text-2xs text-fg-muted">
            No open actions across Plan, Do, Check, Act, or Ops
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
        <Btn size="sm" variant="ghost" onClick={() => onTab('stages')}>
          View stages
        </Btn>
      ) : null}
    </div>
  )
}
