/**
 * FILE: FeedbackSnapshotStrip.tsx
 * PURPOSE: Product feedback KPI strip using MetricStrip — replaces hand-rolled grid on FeedbackPage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { FeedbackStats } from './types'
import {
  totalTicketsTooltip,
  totalTicketsDetail,
  activeTicketsTooltip,
  activeTicketsDetail,
  shippedTicketsTooltip,
  shippedTicketsDetail,
  ticketMixTooltip,
  ticketMixDetail,
} from '../../lib/statTooltips/feedback'
import { feedbackLinks } from '../../lib/statCardLinks'

interface Props {
  stats: FeedbackStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function FeedbackSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'FEEDBACK SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="Feedback snapshot">
        <StatCard
          label={statLabels?.total ?? 'Total'}
          value={stats.totalTickets}
          accent={stats.totalTickets > 0 ? 'text-fg' : undefined}
          tooltip={totalTicketsTooltip(stats)}
          detail={totalTicketsDetail(stats)}
          to={feedbackLinks.total}
        />
        <StatCard
          label={statLabels?.active ?? 'Active'}
          value={stats.activeTickets}
          accent={stats.activeTickets > 0 ? 'text-warn' : 'text-ok'}
          tooltip={activeTicketsTooltip(stats)}
          detail={activeTicketsDetail(stats)}
          to={feedbackLinks.active}
        />
        <StatCard
          label={statLabels?.shipped ?? 'Shipped'}
          value={stats.shippedTickets}
          accent={stats.shippedTickets > 0 ? 'text-ok' : undefined}
          tooltip={shippedTicketsTooltip(stats)}
          detail={shippedTicketsDetail(stats)}
          to={feedbackLinks.shipped}
        />
        <StatCard
          label={statLabels?.mix ?? 'Mix'}
          value={`${stats.bugTickets}/${stats.featureTickets}`}
          accent="text-brand"
          tooltip={ticketMixTooltip(stats)}
          detail={ticketMixDetail()}
          to={feedbackLinks.mix}
        />
      </MetricStrip>
    </Section>
  )
}
