/**
 * FILE: FeedbackReadout.tsx
 * PURPOSE: My feedback provenance — stats API ref and ticket/reply posture signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /feedback with active ticket and reply backlog signals
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - FeedbackStats from ./types
 *
 * USAGE:
 * - Mount on FeedbackPage with stats from GET /v1/admin/feedback/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { FeedbackStats } from './types'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: FeedbackStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function FeedbackReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/feedback/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Active tickets',
      value: `${stats.activeTickets} active · ${stats.awaitingReply} awaiting reply`,
      tone: stats.awaitingReply > 0 ? 'warn' : stats.activeTickets > 0 ? 'info' : 'ok',
    },
    {
      label: 'Shipped',
      value: String(stats.shippedTickets),
      tone: stats.shippedTickets > 0 ? 'ok' : 'muted',
    },
    {
      label: 'By category',
      value: `${stats.bugTickets} bug · ${stats.featureTickets} feature · ${stats.billingTickets} billing`,
      tone: stats.totalTickets > 0 ? 'info' : 'muted',
      wrap: true,
    },
    {
      label: 'Latest reply',
      value: stats.latestReplyAt ?? 'No replies yet',
      tone: stats.latestReplyAt ? 'ok' : 'muted',
    },
    {
      label: 'Top ticket',
      value: stats.topTicketSubject ?? '—',
      tone: stats.topTicketSubject ? 'info' : 'muted',
      wrap: true,
    },
    {
      label: 'Last submitted',
      value: stats.lastSubmittedAt ?? 'Never',
      tone: stats.lastSubmittedAt ? 'info' : 'muted',
    },
  ]

  return (
    <Section title="Feedback readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Feedback stats API" url={statsApi} />
          <div className="mt-2">
            <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          </div>
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
