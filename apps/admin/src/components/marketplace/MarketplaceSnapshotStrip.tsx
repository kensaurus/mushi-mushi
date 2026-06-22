/**
 * FILE: MarketplaceSnapshotStrip.tsx
 * PURPOSE: Plugin marketplace KPI strip using MetricStrip — replaces hand-rolled grid on MarketplacePage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { MarketplaceStats } from './types'
import { marketplaceLinks } from '../../lib/statCardLinks'

interface Props {
  stats: MarketplaceStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function MarketplaceSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'MARKETPLACE SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="Marketplace snapshot">
        <StatCard
          label={statLabels?.catalog ?? 'Catalog'}
          value={stats.catalogTotal}
          accent={stats.catalogTotal > 0 ? 'text-brand' : undefined}
          hint="Listed plugins"
          to={marketplaceLinks.catalog}
        />
        <StatCard
          label={statLabels?.installed ?? 'Installed'}
          value={stats.installedTotal}
          accent={stats.installedTotal > 0 ? 'text-ok' : undefined}
          hint={`${stats.installedActive} active · ${stats.installedPaused} paused`}
          to={marketplaceLinks.installed}
        />
        <StatCard
          label={statLabels?.deliveries7d ?? 'Deliveries · 7d'}
          value={stats.deliveries7d}
          accent={stats.deliveries7d > 0 ? 'text-info' : undefined}
          hint={`${stats.deliveriesOk} ok · ${stats.deliveriesFailed} failed`}
          to={marketplaceLinks.deliveries7d}
        />
        <StatCard
          label={statLabels?.successRate ?? 'Success rate'}
          value={stats.deliveries7d > 0 ? `${stats.deliverySuccessRatePct}%` : '—'}
          accent={
            stats.deliverySuccessRatePct >= 95
              ? 'text-ok'
              : stats.deliveriesFailed > 0
                ? 'text-danger'
                : undefined
          }
          hint="Last 7 days"
          to={marketplaceLinks.successRate}
        />
        <StatCard
          label={statLabels?.failing ?? 'Failing'}
          value={stats.failingPlugins}
          accent={stats.failingPlugins > 0 ? 'text-danger' : undefined}
          hint="Last delivery error/timeout"
          to={marketplaceLinks.failing}
        />
        <StatCard
          label={statLabels?.neverDelivered ?? 'Never delivered'}
          value={stats.neverDeliveredPlugins}
          accent={stats.neverDeliveredPlugins > 0 ? 'text-warn' : undefined}
          hint="Active but no delivery yet"
          to={marketplaceLinks.neverDelivered}
        />
      </MetricStrip>
    </Section>
  )
}
