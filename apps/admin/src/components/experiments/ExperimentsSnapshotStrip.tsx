/**
 * FILE: ExperimentsSnapshotStrip.tsx
 * PURPOSE: A/B experiments KPI strip using MetricStrip — replaces hand-rolled grid on ExperimentsPage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { ExperimentsStats } from './ExperimentsStatsTypes'
import {
  totalExperimentsTooltip,
  totalExperimentsDetail,
  runningCountTooltip,
  runningCountDetail,
  draftsReadyToLaunchTooltip,
  draftsReadyToLaunchDetail,
  winnersFoundTooltip,
  winnersFoundDetail,
  totalAssignmentsTooltip,
  totalAssignmentsDetail,
  conversionRateTooltip,
  conversionRateDetail,
} from '../../lib/statTooltips/experiments'
import { experimentsLinks } from '../../lib/statCardLinks'

interface Props {
  stats: ExperimentsStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function ExperimentsSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'EXPERIMENTS SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="Experiments snapshot">
        <StatCard
          label={statLabels?.total ?? 'Total'}
          value={stats.totalExperiments}
          accent={stats.totalExperiments > 0 ? 'text-brand' : undefined}
          tooltip={totalExperimentsTooltip(stats)}
          detail={totalExperimentsDetail(stats)}
          to={experimentsLinks.total}
        />
        <StatCard
          label={statLabels?.running ?? 'Running'}
          value={stats.runningCount}
          accent={stats.runningCount > 0 ? 'text-warn' : 'text-ok'}
          tooltip={runningCountTooltip(stats)}
          detail={runningCountDetail()}
          to={experimentsLinks.running}
        />
        <StatCard
          label={statLabels?.readyToLaunch ?? 'Ready to launch'}
          value={stats.draftsReadyToLaunch}
          accent={stats.draftsReadyToLaunch > 0 ? 'text-brand' : undefined}
          tooltip={draftsReadyToLaunchTooltip(stats)}
          detail={draftsReadyToLaunchDetail()}
          to={experimentsLinks.readyToLaunch}
        />
        <StatCard
          label={statLabels?.winners ?? 'Winners'}
          value={stats.winnersFound}
          accent={stats.winnersFound > 0 ? 'text-ok' : undefined}
          tooltip={winnersFoundTooltip(stats)}
          detail={winnersFoundDetail()}
          to={experimentsLinks.winners}
        />
        <StatCard
          label={statLabels?.assignments ?? 'Assignments'}
          value={stats.totalAssignments}
          accent={stats.totalAssignments > 0 ? 'text-brand' : undefined}
          tooltip={totalAssignmentsTooltip(stats)}
          detail={totalAssignmentsDetail(stats)}
          to={experimentsLinks.assignments}
        />
        <StatCard
          label={statLabels?.conversion ?? 'Conversion'}
          value={`${stats.conversionRatePct}%`}
          accent={stats.conversionRatePct > 0 ? 'text-ok' : undefined}
          tooltip={conversionRateTooltip(stats)}
          detail={conversionRateDetail(stats)}
          to={experimentsLinks.conversion}
        />
      </MetricStrip>
    </Section>
  )
}
