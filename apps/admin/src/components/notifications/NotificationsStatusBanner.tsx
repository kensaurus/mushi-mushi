/**
 * FILE: apps/admin/src/components/notifications/NotificationsStatusBanner.tsx
 * PURPOSE: Stats-driven reporter notification health for the active project.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { NotificationStats, NotificationTabId } from './types'

interface Props {
  stats: NotificationStats
  onTab?: (tab: NotificationTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
}

function tabFromPath(path: string | null): NotificationTabId | null {
  if (!path) return null
  const tab = new URL(path, 'http://local').searchParams.get('tab')
  if (tab === 'inbox' || tab === 'setup' || tab === 'overview') return tab
  return null
}

export function NotificationsStatusBanner({ stats, onTab, onRefresh, refreshing }: Props) {
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No project selected</p>
            <p className="text-2xs text-fg-muted">Reporter notifications are scoped to the active project in the header.</p>
          </div>
        </div>
      </div>
    )
  }

  const priority = stats.topPriority
  const label = stats.topPriorityLabel
  const actionTab = tabFromPath(stats.topPriorityTo)

  if (priority === 'disabled') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Reporter notifications disabled</p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        <Link to="/settings">
          <Btn size="sm" variant="primary">Open Settings</Btn>
        </Link>
      </div>
    )
  }

  if (priority === 'unread_backlog') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.unread} unread message{stats.unread === 1 ? '' : 's'}
            </p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('inbox')}>Review inbox</Btn>
        ) : actionTab ? (
          <Link to={stats.topPriorityTo ?? '/notifications?tab=inbox'}>
            <Btn size="sm" variant="ghost">Review inbox</Btn>
          </Link>
        ) : null}
      </div>
    )
  }

  if (priority === 'no_messages') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">No messages on {projectLabel} yet</p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="primary" onClick={() => onTab('setup')}>Open Setup</Btn>
        ) : (
          <Link to="/notifications?tab=setup">
            <Btn size="sm" variant="primary">Open Setup</Btn>
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">Reporter loop active on {projectLabel}</p>
          <p className="text-2xs text-fg-muted">{label}</p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          Refresh
        </Btn>
      ) : onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('inbox')}>View inbox</Btn>
      ) : null}
    </div>
  )
}
