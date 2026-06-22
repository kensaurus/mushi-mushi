/**
 * FILE: QuerySnapshotStrip.tsx
 * PURPOSE: Query analytics KPI strip using MetricStrip — replaces hand-rolled grid on QueryPage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { QueryStats } from './types'
import {
  runs24hTooltip,
  runs24hDetail,
  errors24hTooltip,
  errors24hDetail,
  savedCountTooltip,
  savedCountDetail,
  latencyTooltip,
  latencyDetail,
} from '../../lib/statTooltips/query'
import { queryLinks } from '../../lib/statCardLinks'

interface Props {
  stats: QueryStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function QuerySnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'Query snapshot',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="Query snapshot">
        <StatCard
          label={statLabels?.runs24h ?? 'Runs 24h'}
          value={stats.runs24h}
          accent={stats.runs24h > 0 ? 'text-brand' : undefined}
          tooltip={runs24hTooltip(stats)}
          detail={runs24hDetail(stats)}
          to={queryLinks.runs24h}
        />
        <StatCard
          label={statLabels?.errors24h ?? 'Errors 24h'}
          value={stats.errors24h}
          accent={stats.errors24h > 0 ? 'text-danger' : 'text-ok'}
          tooltip={errors24hTooltip(stats)}
          detail={errors24hDetail(stats)}
          to={queryLinks.errors24h}
        />
        <StatCard
          label={statLabels?.saved ?? 'Saved'}
          value={stats.savedCount}
          accent={stats.savedCount > 0 ? 'text-ok' : 'text-warn'}
          tooltip={savedCountTooltip(stats)}
          detail={savedCountDetail(stats)}
          to={queryLinks.saved}
        />
        <StatCard
          label={statLabels?.latency ?? 'Latency'}
          value={stats.avgLatencyMs != null ? `${stats.avgLatencyMs}ms` : '—'}
          accent="text-info"
          tooltip={latencyTooltip(stats)}
          detail={latencyDetail(stats)}
          to={queryLinks.latency}
        />
      </MetricStrip>
    </Section>
  )
}
