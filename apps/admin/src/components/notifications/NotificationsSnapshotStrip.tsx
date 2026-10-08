/**
 * FILE: NotificationsSnapshotStrip.tsx
 * PURPOSE: Notifications KPI strip using MetricStrip — replaces hand-rolled 6-col grid.
 */

import { Section, StatCard, SnapshotSectionHint, formatRelative } from '../ui'
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
      <MetricStrip cols={4} ariaLabel="Notifications snapshot">
        <StatCard
          label={statLabels?.total ?? 'Total'}
          value={stats.total}
          hint="Messages for this project"
          to={notificationsLinks.total}
        />
        <StatCard
          label={statLabels?.unread ?? 'Unread'}
          value={stats.unread}
          hint="Not opened yet by the reporter in the widget (or marked read here)"
          to={notificationsLinks.unread}
        />
        <StatCard
          label={statLabels?.last24h ?? 'Last 24h'}
          value={stats.last24h}
          hint="Recent outbound volume"
          to={notificationsLinks.last24h}
        />
        <StatCard
          label={statLabels?.lastMessage ?? 'Last message'}
          value={stats.lastNotificationAt ? formatRelative(stats.lastNotificationAt) : 'Never'}
          hint={
            stats.lastNotificationAt
              ? new Date(stats.lastNotificationAt).toLocaleString()
              : 'Classify a report to test'
          }
          to={notificationsLinks.lastMessage}
        />
      </MetricStrip>
    </Section>
  )
}
