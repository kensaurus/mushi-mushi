/**
 * FILE: NotificationsSnapshotStrip.tsx
 * PURPOSE: Notifications KPI strip using MetricStrip — replaces hand-rolled 6-col grid.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { NotificationStats } from './types'
import { notificationsLinks } from '../../lib/statCardLinks'

interface Props {
  stats: NotificationStats
  fetchedAt: string | null
  isValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function NotificationsSnapshotStrip({
  stats,
  fetchedAt,
  isValidating,
  sectionTitle = 'NOTIFICATIONS SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: fetchedAt, isValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="Notifications snapshot">
        <StatCard
          label={statLabels?.total ?? 'Total'}
          value={stats.total}
          accent={stats.total > 0 ? 'text-brand' : undefined}
          hint="Messages for this project"
          to={notificationsLinks.total}
        />
        <StatCard
          label={statLabels?.unread ?? 'Unread'}
          value={stats.unread}
          accent={stats.unread > 0 ? 'text-warn' : undefined}
          hint="Not yet marked read in admin"
          to={notificationsLinks.unread}
        />
        <StatCard
          label={statLabels?.last24h ?? 'Last 24h'}
          value={stats.last24h}
          accent={stats.last24h > 0 ? 'text-info' : undefined}
          hint="Recent outbound volume"
          to={notificationsLinks.last24h}
        />
        <StatCard
          label={statLabels?.enabled ?? 'Enabled'}
          value={stats.notificationsEnabled ? 'Yes' : 'No'}
          accent={stats.notificationsEnabled ? 'text-ok' : 'text-warn'}
          hint={stats.notificationsEnabled ? 'SDK polling allowed' : 'Turn on in Settings'}
          to={notificationsLinks.enabled}
        />
        <StatCard
          label={statLabels?.fixFailed ?? 'Fix failed'}
          value={stats.fixFailedCount}
          accent={stats.fixFailedCount > 0 ? 'text-danger' : undefined}
          hint="fix_failed type messages"
          to={notificationsLinks.fixFailed}
        />
        <StatCard
          label={statLabels?.lastMessage ?? 'Last message'}
          value={stats.lastNotificationAt ? 'Recent' : 'Never'}
          accent={stats.lastNotificationAt ? 'text-ok' : undefined}
          hint={
            stats.daysSinceLastNotification != null && stats.daysSinceLastNotification > 0
              ? `${stats.daysSinceLastNotification}d ago`
              : stats.lastNotificationAt
                ? 'Today'
                : 'Classify a report to test'
          }
          to={notificationsLinks.lastMessage}
        />
      </MetricStrip>
    </Section>
  )
}
