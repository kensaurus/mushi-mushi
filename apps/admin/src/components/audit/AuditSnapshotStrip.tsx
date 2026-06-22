/**
 * FILE: AuditSnapshotStrip.tsx
 * PURPOSE: Audit log KPI strip using MetricStrip — replaces hand-rolled grid on AuditPage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { AuditStats } from './types'
import {
  events24hTooltip,
  events24hDetail,
  failCount24hTooltip,
  failCount24hDetail,
  actorMixTooltip,
  actorMixDetail,
  totalEventsTooltip,
  totalEventsDetail,
} from '../../lib/statTooltips/audit'
import { auditLinks } from '../../lib/statCardLinks'

interface Props {
  stats: AuditStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function AuditSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'Audit snapshot',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="Audit snapshot">
        <StatCard
          label={statLabels?.events24h ?? '24h events'}
          value={stats.events24h}
          accent={stats.events24h > 0 ? 'text-brand' : undefined}
          tooltip={events24hTooltip(stats)}
          detail={events24hDetail(stats)}
          to={auditLinks.events24h}
        />
        <StatCard
          label={statLabels?.failures ?? 'Failures'}
          value={stats.failCount24h}
          accent={stats.failCount24h > 0 ? 'text-danger' : 'text-ok'}
          tooltip={failCount24hTooltip(stats)}
          detail={failCount24hDetail()}
          to={auditLinks.failures}
        />
        <StatCard
          label={statLabels?.actorMix ?? 'Actor mix'}
          value={`${stats.humanCount24h}/${stats.agentCount24h}/${stats.systemCount24h}`}
          accent={stats.agentCount24h > 0 ? 'text-info' : undefined}
          tooltip={actorMixTooltip(stats)}
          detail={actorMixDetail()}
          to={auditLinks.actorMix}
        />
        <StatCard
          label={statLabels?.allTime ?? 'All-time'}
          value={stats.totalEvents.toLocaleString()}
          accent="text-brand"
          tooltip={totalEventsTooltip(stats)}
          detail={totalEventsDetail(stats)}
          to={auditLinks.allTime}
        />
      </MetricStrip>
    </Section>
  )
}
