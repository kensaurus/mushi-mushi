/**
 * FILE: InboxSnapshotStrip.tsx
 * PURPOSE: Dedicated inbox KPI strip using MetricStrip — replaces hand-rolled grid.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { InboxStats } from './types'
import {
  backlogDetail,
  backlogTooltip,
  clearDetail,
  clearTooltip,
  criticalDetail,
  criticalTooltip,
  openDetail,
  openTooltip,
} from '../../lib/statTooltips/inbox'
import { inboxLinks, statLink } from '../../lib/statCardLinks'

interface Props {
  stats: InboxStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  plainStageLabels?: boolean
}

export function InboxSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'INBOX SNAPSHOT',
  hint,
  plainStageLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="Inbox snapshot">
        <StatCard
          label="Open"
          value={stats.openActions}
          accent={stats.openActions > 0 ? 'text-danger' : 'text-ok'}
          tooltip={openTooltip(stats)}
          detail={openDetail(stats)}
          to={statLink(inboxLinks.open, stats)}
        />
        <StatCard
          label="Clear"
          value={stats.clearStages}
          accent="text-ok"
          tooltip={clearTooltip(stats, plainStageLabels)}
          detail={clearDetail(stats, plainStageLabels)}
          to={inboxLinks.clear}
        />
        <StatCard
          label="Backlog"
          value={stats.openBacklog}
          accent={stats.openBacklog > 0 ? 'text-warn' : undefined}
          tooltip={backlogTooltip(stats)}
          detail={backlogDetail(stats)}
          to={inboxLinks.backlog}
        />
        <StatCard
          label="Critical 14d"
          value={stats.criticalReports14d}
          accent={stats.criticalReports14d > 0 ? 'text-brand' : undefined}
          tooltip={criticalTooltip(stats)}
          detail={criticalDetail(stats)}
          to={inboxLinks.critical}
        />
      </MetricStrip>
    </Section>
  )
}
