/**
 * FILE: DriftSnapshotStrip.tsx
 * PURPOSE: Contract drift KPI strip using MetricStrip — replaces hand-rolled 6-col grid.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { DriftStats } from './DriftStatsTypes'
import {
  contractEdgesDetail,
  contractEdgesTooltip,
  criticalOpenDetail,
  criticalOpenTooltip,
  openFindingsDetail,
  openFindingsTooltip,
  snapshotsDetail,
  snapshotsTooltip,
  surfacesWithFindingsDetail,
  surfacesWithFindingsTooltip,
  warnOpenDetail,
  warnOpenTooltip,
} from '../../lib/statTooltips/drift'
import { driftLinks } from '../../lib/statCardLinks'
import { usePlainStatTooltips } from '../../lib/usePlainStatTooltips'

interface Props {
  stats: DriftStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function DriftSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'DRIFT SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  const plainOpts = usePlainStatTooltips()

  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="Drift snapshot">
        <StatCard
          label={statLabels?.openFindings ?? 'Open findings'}
          value={stats.openFindings}
          accent={stats.openFindings > 0 ? 'text-warn' : 'text-ok'}
          tooltip={openFindingsTooltip(stats, plainOpts)}
          detail={openFindingsDetail(stats)}
          to={driftLinks.openFindings}
        />
        <StatCard
          label={statLabels?.critical ?? 'Critical'}
          value={stats.criticalOpen}
          accent={stats.criticalOpen > 0 ? 'text-danger' : 'text-ok'}
          tooltip={criticalOpenTooltip(stats, plainOpts)}
          detail={criticalOpenDetail(plainOpts)}
          to={driftLinks.critical}
        />
        <StatCard
          label={statLabels?.warnings ?? 'Warnings'}
          value={stats.warnOpen}
          accent={stats.warnOpen > 0 ? 'text-warn' : undefined}
          tooltip={warnOpenTooltip(stats)}
          detail={warnOpenDetail(stats)}
          to={driftLinks.warnings}
        />
        <StatCard
          label={statLabels?.snapshots ?? 'Snapshots'}
          value={stats.snapshotCount}
          accent={stats.snapshotCount > 0 ? 'text-brand' : undefined}
          tooltip={snapshotsTooltip(stats)}
          detail={snapshotsDetail(stats)}
          to={driftLinks.snapshots}
        />
        <StatCard
          label={statLabels?.contractEdges ?? 'Contract edges'}
          value={stats.lastSnapshotEdges}
          accent={stats.lastSnapshotEdges > 0 ? 'text-brand' : undefined}
          tooltip={contractEdgesTooltip(stats)}
          detail={contractEdgesDetail(stats)}
          to={driftLinks.contractEdges}
        />
        <StatCard
          label={statLabels?.surfaces ?? 'Surfaces'}
          value={stats.surfacesWithFindings}
          accent={stats.surfacesWithFindings > 0 ? 'text-warn' : undefined}
          tooltip={surfacesWithFindingsTooltip(stats)}
          detail={surfacesWithFindingsDetail()}
          to={driftLinks.surfaces}
        />
      </MetricStrip>
    </Section>
  )
}
