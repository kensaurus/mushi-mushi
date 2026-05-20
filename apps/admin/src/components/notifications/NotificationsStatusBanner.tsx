/**
 * FILE: apps/admin/src/components/notifications/NotificationsStatusBanner.tsx
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { NotificationStats } from './types'

interface Props {
  stats: NotificationStats
  projectName: string | null
}

export function NotificationsStatusBanner({ stats, projectName }: Props) {
  if (!stats.notificationsEnabled) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Reporter notifications disabled</p>
            <p className="text-2xs text-fg-muted">
              {projectName
                ? `Turn on reporter_notifications_enabled for ${projectName} in Settings — otherwise the SDK widget never receives outbound messages.`
                : 'Enable reporter notifications in Settings so the SDK widget can poll outbound messages.'}
            </p>
          </div>
        </div>
        <Link to="/settings">
          <Btn size="sm" variant="ghost">Open Settings</Btn>
        </Link>
      </div>
    )
  }

  if (stats.total === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {projectName ? `No reporter notifications for ${projectName} yet` : 'No reporter notifications yet'}
            </p>
            <p className="text-2xs text-fg-muted">
              Messages appear when a report is classified, fixed, rewarded, or replied to — the SDK polls this queue for the reporter widget.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (stats.unread > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.unread} unread message{stats.unread === 1 ? '' : 's'}
            </p>
            <p className="text-2xs text-fg-muted">
              Unread items may mean the reporter SDK stopped polling — expand payloads to debug delivery.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">Reporter loop active</p>
          <p className="text-2xs text-fg-muted">
            {stats.total} total · {stats.last24h} in 24h · all read
            {projectName ? ` · ${projectName}` : ''}
          </p>
        </div>
      </div>
      {stats.lastNotificationAt && (
        <span className="font-mono text-3xs text-fg-faint shrink-0">
          Last {new Date(stats.lastNotificationAt).toLocaleString()}
        </span>
      )}
    </div>
  )
}
