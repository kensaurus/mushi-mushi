/**
 * FILE: NotificationsSnapshotStrip.tsx
 * PURPOSE: Reporter updates status: did the people who reported bugs hear back,
 *          and did they open it (PageStatus, P1).
 */

import { PageStatus, formatRelative } from '../ui'
import type { NotificationStats } from './types'
import { pluralizeWithCount } from '../../lib/format'
import { notificationsLinks } from '../../lib/statCardLinks'

interface Props {
  stats: NotificationStats
  fetchedAt: string | null
  isValidating?: boolean
  statLabels?: Record<string, string>
}

function updatesSentence(stats: NotificationStats): string {
  if (!stats.notificationsEnabled) return 'Reporter updates are off: the people who report bugs do not hear back.'
  if (stats.total === 0) return 'No updates sent to reporters yet.'
  const last = stats.lastNotificationAt ? `, the last ${formatRelative(stats.lastNotificationAt)}` : ''
  const unopened = stats.unread > 0 ? `; ${stats.unread} not opened yet` : '; all opened'
  return `${pluralizeWithCount(stats.total, 'update')} sent to reporters${last}${unopened}.`
}

export function NotificationsSnapshotStrip({ stats, fetchedAt, isValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Reporter updates status"
      tone={!stats.notificationsEnabled ? 'warn' : stats.unread > 0 ? 'info' : 'ok'}
      sentence={updatesSentence(stats)}
      freshness={{ at: fetchedAt, isValidating }}
      metrics={[
        {
          label: statLabels?.total ?? 'Sent',
          value: stats.total,
          hint: 'Updates sent to the people who reported bugs: diagnosed, fixed, shipped.',
          to: notificationsLinks.total,
        },
        {
          label: statLabels?.unread ?? 'Not opened',
          value: stats.unread,
          tone: stats.unread > 0 ? 'warn' : 'neutral',
          hint: 'Updates the reporter has not opened yet.',
          to: notificationsLinks.unread,
        },
        {
          label: statLabels?.last24h ?? 'Sent today',
          value: stats.last24h,
          hint: 'Updates sent in the last 24 hours.',
          to: notificationsLinks.last24h,
        },
      ]}
    />
  )
}
