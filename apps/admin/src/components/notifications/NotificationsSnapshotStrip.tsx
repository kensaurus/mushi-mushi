/**
 * FILE: NotificationsSnapshotStrip.tsx
 * PURPOSE: Reporter updates status: did the people who reported bugs hear back,
 *          and did they open it (PageStatus, P1). It is the page's ONE status
 *          row (round-2 review 2026-11-18): the "2 updates not opened" banner
 *          above it said the same count again, so its action lives here now.
 *          "Not opened" is normal, not a fault: neutral, never amber. A zero
 *          "Sent today" is not drawn.
 */

import { Btn, PageStatus, formatRelative, toMetrics } from '../ui'
import type { NotificationStats, NotificationTabId } from './types'
import { notificationsLinks } from '../../lib/statCardLinks'
import { notificationsStatusAction, notificationsStatusSentence } from '../../lib/notificationsView'

interface Props {
  stats: NotificationStats
  fetchedAt: string | null
  isValidating?: boolean
  statLabels?: Record<string, string>
  onTab?: (tab: NotificationTabId) => void
}

export function NotificationsSnapshotStrip({ stats, fetchedAt, isValidating, statLabels, onTab }: Props) {
  const action = notificationsStatusAction(stats)
  const sentence = notificationsStatusSentence(stats, stats.lastNotificationAt ? formatRelative(stats.lastNotificationAt) : null)
  return (
    <PageStatus
      ariaLabel="Reporter updates status"
      tone={!stats.notificationsEnabled ? 'warn' : stats.unread > 0 ? 'info' : 'ok'}
      sentence={sentence}
      freshness={{ at: fetchedAt, isValidating }}
      action={
        action && onTab ? (
          <Btn size="sm" variant={action.primary ? 'primary' : 'ghost'} onClick={() => onTab(action.tab)} data-testid="notifications-status-action">
            {action.label}
          </Btn>
        ) : null
      }
      metrics={toMetrics([
        {
          label: statLabels?.total ?? 'Sent',
          value: stats.total,
          hint: 'Updates sent to the people who reported bugs: diagnosed, fixed, shipped.',
          to: notificationsLinks.total,
        },
        {
          label: statLabels?.unread ?? 'Not opened',
          value: stats.unread,
          hint: 'Updates the reporter has not opened yet. Normal: they see them the next time they open the widget.',
          to: notificationsLinks.unread,
        },
        ...(stats.last24h > 0
          ? [
              {
                label: statLabels?.last24h ?? 'Sent today',
                value: stats.last24h,
                hint: 'Updates sent in the last 24 hours.',
                to: notificationsLinks.last24h,
              },
            ]
          : []),
      ])}
    />
  )
}
