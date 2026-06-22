/**
 * FILE: ComplianceSnapshotStrip.tsx
 * PURPOSE: Compliance posture KPI strip using MetricStrip — replaces hand-rolled grid on CompliancePage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { ComplianceStats } from './types'
import {
  controlsTooltip,
  controlsDetail,
  openDsarsTooltip,
  openDsarsDetail,
  legalHoldsTooltip,
  legalHoldsDetail,
  clusterRegionTooltip,
  clusterRegionDetail,
} from '../../lib/statTooltips/compliance'
import { complianceLinks } from '../../lib/statCardLinks'

interface Props {
  stats: ComplianceStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function ComplianceSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'Compliance snapshot',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="Compliance snapshot">
        <StatCard
          label={statLabels?.controls ?? 'Controls'}
          value={`${stats.controlsPass}/${stats.controlsTotal}`}
          accent={
            stats.controlsFail > 0
              ? 'text-danger'
              : stats.controlsWarn > 0
                ? 'text-warn'
                : stats.controlsTotal > 0
                  ? 'text-ok'
                  : undefined
          }
          tooltip={controlsTooltip(stats)}
          detail={controlsDetail(stats)}
          to={complianceLinks.controls}
        />
        <StatCard
          label={statLabels?.openDsars ?? 'Open DSARs'}
          value={stats.openDsars}
          accent={
            stats.overdueDsars > 0
              ? 'text-danger'
              : stats.atRiskDsars > 0
                ? 'text-warn'
                : undefined
          }
          tooltip={openDsarsTooltip(stats)}
          detail={openDsarsDetail(stats)}
          to={complianceLinks.openDsars}
        />
        <StatCard
          label={statLabels?.legalHolds ?? 'Legal holds'}
          value={stats.legalHoldCount}
          accent={stats.legalHoldCount > 0 ? 'text-info' : undefined}
          tooltip={legalHoldsTooltip(stats)}
          detail={legalHoldsDetail(stats)}
          to={complianceLinks.legalHolds}
        />
        <StatCard
          label={statLabels?.cluster ?? 'Cluster'}
          value={(stats.activeProjectRegion ?? stats.currentRegion).toUpperCase()}
          accent="text-brand"
          tooltip={clusterRegionTooltip(stats)}
          detail={clusterRegionDetail(stats)}
          to={complianceLinks.cluster}
        />
      </MetricStrip>
    </Section>
  )
}
