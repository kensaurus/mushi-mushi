/**
 * FILE: LessonsSnapshotStrip.tsx
 * PURPOSE: Lessons library KPI strip using MetricStrip — replaces hand-rolled grid on LessonsPage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { LessonsStats } from './LessonsStatsTypes'
import {
  activeLessonsTooltip,
  activeLessonsDetail,
  criticalLessonsTooltip,
  criticalLessonsDetail,
  candidatesTooltip,
  candidatesDetail,
  promotedClustersTooltip,
  promotedClustersDetail,
  reportsClusteredTooltip,
  reportsClusteredDetail,
  highCoherenceTooltip,
  highCoherenceDetail,
} from '../../lib/statTooltips/lessons'
import { lessonsLinks } from '../../lib/statCardLinks'

interface Props {
  stats: LessonsStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function LessonsSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'LESSONS SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="Lessons snapshot">
        <StatCard
          label={statLabels?.activeLessons ?? 'Active lessons'}
          value={stats.activeLessons}
          accent={stats.activeLessons > 0 ? 'text-ok' : undefined}
          tooltip={activeLessonsTooltip(stats)}
          detail={activeLessonsDetail(stats)}
          to={lessonsLinks.activeLessons}
        />
        <StatCard
          label={statLabels?.critical ?? 'Critical'}
          value={stats.criticalLessons}
          accent={stats.criticalLessons > 0 ? 'text-danger' : 'text-ok'}
          tooltip={criticalLessonsTooltip(stats)}
          detail={criticalLessonsDetail()}
          to={lessonsLinks.critical}
        />
        <StatCard
          label={statLabels?.candidates ?? 'Candidates'}
          value={stats.candidateClusters}
          accent={stats.candidateClusters > 0 ? 'text-warn' : undefined}
          tooltip={candidatesTooltip(stats)}
          detail={candidatesDetail(stats)}
          to={lessonsLinks.candidates}
        />
        <StatCard
          label={statLabels?.promoted ?? 'Promoted clusters'}
          value={stats.promotedClusters}
          accent={stats.promotedClusters > 0 ? 'text-brand' : undefined}
          tooltip={promotedClustersTooltip(stats)}
          detail={promotedClustersDetail()}
          to={lessonsLinks.promoted}
        />
        <StatCard
          label={statLabels?.reportsClustered ?? 'Reports clustered'}
          value={stats.totalClusterReports}
          accent={stats.totalClusterReports > 0 ? 'text-brand' : undefined}
          tooltip={reportsClusteredTooltip(stats)}
          detail={reportsClusteredDetail()}
          to={lessonsLinks.reportsClustered}
        />
        <StatCard
          label={statLabels?.highCoherence ?? 'High coherence'}
          value={stats.highCoherenceCandidates}
          accent={stats.highCoherenceCandidates > 0 ? 'text-ok' : undefined}
          tooltip={highCoherenceTooltip(stats)}
          detail={highCoherenceDetail()}
          to={lessonsLinks.highCoherence}
        />
      </MetricStrip>
    </Section>
  )
}
