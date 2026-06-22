/**
 * FILE: StorageSnapshotStrip.tsx
 * PURPOSE: Storage health KPI strip using MetricStrip — replaces hand-rolled grid on StoragePage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { StorageStats } from './types'
import {
  healthyCountTooltip,
  healthyCountDetail,
  screenshotsTooltip,
  screenshotsDetail,
  providerTooltip,
  providerDetail,
  unconfiguredCountTooltip,
  unconfiguredCountDetail,
} from '../../lib/statTooltips/storage'
import { storageLinks } from '../../lib/statCardLinks'

interface Props {
  stats: StorageStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function StorageSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'Storage snapshot',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="Storage snapshot">
        <StatCard
          label={statLabels?.healthy ?? 'Healthy'}
          value={`${stats.healthyCount}/${stats.configuredCount}`}
          accent={
            stats.failingCount > 0
              ? 'text-danger'
              : stats.healthyCount > 0
                ? 'text-ok'
                : undefined
          }
          tooltip={healthyCountTooltip(stats)}
          detail={healthyCountDetail(stats)}
          to={storageLinks.healthy}
        />
        <StatCard
          label={statLabels?.screenshots ?? 'Screenshots'}
          value={stats.activeProjectObjects.toLocaleString()}
          accent={stats.activeProjectObjects > 0 ? 'text-brand' : undefined}
          tooltip={screenshotsTooltip(stats)}
          detail={screenshotsDetail(stats)}
          to={storageLinks.screenshots}
        />
        <StatCard
          label={statLabels?.provider ?? 'Provider'}
          value={stats.activeProjectProvider}
          accent="text-info"
          tooltip={providerTooltip(stats)}
          detail={providerDetail(stats)}
          to={storageLinks.provider}
        />
        <StatCard
          label={statLabels?.unconfigured ?? 'Unconfigured'}
          value={stats.unconfiguredCount}
          accent={stats.unconfiguredCount > 0 ? 'text-warn' : 'text-ok'}
          tooltip={unconfiguredCountTooltip(stats)}
          detail={unconfiguredCountDetail(stats)}
          to={storageLinks.unconfigured}
        />
      </MetricStrip>
    </Section>
  )
}
