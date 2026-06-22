/**
 * FILE: IntelligenceSnapshotStrip.tsx
 * PURPOSE: Intelligence KPI strip using MetricStrip — replaces hand-rolled 6-col grid.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { IntelligenceStats } from './IntelligenceStatsTypes'
import {
  activeJobsDetail,
  activeJobsTooltip,
  benchmarkingDetail,
  benchmarkingTooltip,
  digestsDetail,
  digestsTooltip,
  failedJobsDetail,
  failedJobsTooltip,
  findingsDetail,
  findingsTooltip,
  fixAttemptsDetail,
  fixAttemptsTooltip,
} from '../../lib/statTooltips/intelligence'
import { intelligenceLinks } from '../../lib/statCardLinks'

interface Props {
  stats: IntelligenceStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function IntelligenceSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'INTELLIGENCE SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="Intelligence snapshot">
        <StatCard
          label={statLabels?.digests ?? 'Digests'}
          value={stats.reportCount}
          accent={stats.reportCount > 0 ? 'text-ok' : undefined}
          tooltip={digestsTooltip(stats)}
          detail={digestsDetail(stats)}
          to={intelligenceLinks.digests}
        />
        <StatCard
          label={statLabels?.activeJobs ?? 'Active jobs'}
          value={stats.activeJobCount}
          accent={stats.activeJobCount > 0 ? 'text-brand' : undefined}
          tooltip={activeJobsTooltip(stats)}
          detail={activeJobsDetail(stats)}
          to={intelligenceLinks.activeJobs}
        />
        <StatCard
          label={statLabels?.failedJobs ?? 'Failed jobs'}
          value={stats.failedJobCount}
          accent={stats.failedJobCount > 0 ? 'text-danger' : undefined}
          tooltip={failedJobsTooltip(stats)}
          detail={failedJobsDetail(stats)}
          to={intelligenceLinks.failedJobs}
        />
        <StatCard
          label={statLabels?.findings ?? 'Findings'}
          value={stats.pendingFindings}
          accent={stats.pendingFindings > 0 ? 'text-warn' : undefined}
          tooltip={findingsTooltip(stats)}
          detail={findingsDetail(stats)}
          to={intelligenceLinks.findings}
        />
        <StatCard
          label={statLabels?.fixAttempts ?? 'Fix attempts'}
          value={stats.totalFixAttempts}
          accent={stats.totalFixAttempts > 0 ? 'text-brand' : undefined}
          tooltip={fixAttemptsTooltip(stats)}
          detail={fixAttemptsDetail(stats)}
          to={intelligenceLinks.fixAttempts}
        />
        <StatCard
          label={statLabels?.benchmarking ?? 'Benchmarking'}
          value={stats.benchmarkOptIn ? 'On' : 'Off'}
          accent={stats.benchmarkOptIn ? 'text-ok' : undefined}
          tooltip={benchmarkingTooltip(stats)}
          detail={benchmarkingDetail(stats)}
          to={intelligenceLinks.benchmarking}
        />
      </MetricStrip>
    </Section>
  )
}
