/**
 * FILE: apps/admin/src/components/notifications/NotificationsStatusBanner.tsx
 * PURPOSE: Stats-driven reporter notification health for the active project.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { NotificationStats, NotificationTabId } from './types'

interface Props {
  stats: NotificationStats
  onTab?: (tab: NotificationTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

function tabFromPath(path: string | null): NotificationTabId | null {
  if (!path) return null
  const tab = new URL(path, 'http://local').searchParams.get('tab')
  if (tab === 'inbox' || tab === 'setup' || tab === 'overview') return tab
  return null
}

export function NotificationsStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/notifications')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'Reporter updates are per app — choose one in the header.'
            : 'Reporter notifications are scoped to the active project in the header.'
        }
      />
    )
  }

  const priority = stats.topPriority
  const label = stats.topPriorityLabel
  const actionTab = tabFromPath(stats.topPriorityTo)

  if (priority === 'disabled') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Reporter updates are turned off' : 'Reporter notifications disabled'}
        subtitle={label}
        action={
          <Link to="/settings">
            <Btn size="sm" variant="primary">{actions.settings ?? 'Open Settings'}</Btn>
          </Link>
        }
      />
    )
  }

  if (priority === 'unread_backlog') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.unread} unread update${stats.unread === 1 ? '' : 's'} for reporters`
            : `${stats.unread} unread message${stats.unread === 1 ? '' : 's'}`
        }
        subtitle={label}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('inbox')}>{actions.inbox ?? 'Review inbox'}</Btn>
          ) : actionTab ? (
            <Link to={stats.topPriorityTo ?? '/notifications?tab=inbox'}>
              <Btn size="sm" variant="ghost">{actions.inbox ?? 'Review inbox'}</Btn>
            </Link>
          ) : null
        }
      />
    )
  }

  if (priority === 'no_messages') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No reporter messages yet' : `No messages on ${projectLabel} yet`}
        subtitle={label}
        action={
          onTab ? (
            <Btn size="sm" variant="primary" onClick={() => onTab('setup')}>{actions.setup ?? 'Open Setup'}</Btn>
          ) : (
            <Link to="/notifications?tab=setup">
              <Btn size="sm" variant="primary">{actions.setup ?? 'Open Setup'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Reporter updates are working' : `Reporter loop active on ${projectLabel}`}
      subtitle={label}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('inbox')}>{actions.viewInbox ?? 'View inbox'}</Btn>
        ) : null
      }
    />
  )
}
