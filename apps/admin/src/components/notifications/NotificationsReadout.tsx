/**
 * FILE: NotificationsReadout.tsx
 * PURPOSE: Reporter notification provenance — admin API ref and delivery signals.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { NotificationStats } from './types'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: NotificationStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function NotificationsReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const inboxApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/projects/${encodeURIComponent(stats.projectId)}/notifications`

  const rows: DetailRowItem[] = [
    {
      label: 'SDK polling',
      value: stats.notificationsEnabled ? 'Enabled' : 'Disabled in Settings',
      tone: stats.notificationsEnabled ? 'ok' : 'warn',
    },
    {
      label: 'Unread backlog',
      value: String(stats.unread),
      tone: stats.unread > 10 ? 'warn' : stats.unread > 0 ? 'info' : 'ok',
    },
    {
      label: 'Fix failed (type)',
      value: String(stats.fixFailedCount),
      tone: stats.fixFailedCount > 0 ? 'danger' : 'ok',
    },
    {
      label: 'Last message',
      value: stats.lastNotificationAt ?? 'Never sent',
      tone: stats.lastNotificationAt ? 'info' : 'muted',
    },
    {
      label: 'Project ref',
      value: stats.projectId,
      mono: true,
      copyable: true,
      wrap: true,
    },
  ]

  return (
    <Section title="Notifications readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Notifications inbox API" url={inboxApi} />
          <div className="mt-2">
            <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          </div>
        </ReadoutSection>
        <ReadoutSection title="Delivery signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
