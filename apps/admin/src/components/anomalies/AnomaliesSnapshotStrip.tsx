/**
 * FILE: AnomaliesSnapshotStrip.tsx
 * PURPOSE: Anomaly detection KPI strip using MetricStrip — replaces hand-rolled grid on AnomaliesPage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { AnomaliesStats } from './AnomaliesStatsTypes'
import {
  openAnomaliesTooltip,
  openAnomaliesDetail,
  releaseRegressionTooltip,
  releaseRegressionDetail,
  highScoreTooltip,
  highScoreDetail,
  autoReportedTooltip,
  autoReportedDetail,
  metricPointsTooltip,
  metricPointsDetail,
  dismissedAnomaliesTooltip,
  dismissedAnomaliesDetail,
} from '../../lib/statTooltips/anomalies'
import { anomaliesLinks } from '../../lib/statCardLinks'

interface Props {
  stats: AnomaliesStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function AnomaliesSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'ANOMALIES SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="Anomalies snapshot">
        <StatCard
          label={statLabels?.open ?? 'Open'}
          value={stats.openAnomalies}
          accent={stats.openAnomalies > 0 ? 'text-warn' : 'text-ok'}
          tooltip={openAnomaliesTooltip(stats)}
          detail={openAnomaliesDetail(stats)}
          to={anomaliesLinks.open}
        />
        <StatCard
          label={statLabels?.releaseRegressions ?? 'Release regressions'}
          value={stats.releaseRegressionOpen}
          accent={stats.releaseRegressionOpen > 0 ? 'text-danger' : undefined}
          tooltip={releaseRegressionTooltip(stats)}
          detail={releaseRegressionDetail()}
          to={anomaliesLinks.releaseRegressions}
        />
        <StatCard
          label={statLabels?.highScore ?? 'High score'}
          value={stats.highScoreOpen}
          accent={stats.highScoreOpen > 0 ? 'text-danger' : undefined}
          tooltip={highScoreTooltip(stats)}
          detail={highScoreDetail()}
          to={anomaliesLinks.highScore}
        />
        <StatCard
          label={statLabels?.autoReported ?? 'Auto-reported'}
          value={stats.autoReported}
          accent={stats.autoReported > 0 ? 'text-brand' : undefined}
          tooltip={autoReportedTooltip(stats)}
          detail={autoReportedDetail()}
          to={anomaliesLinks.autoReported}
        />
        <StatCard
          label={statLabels?.metricPoints ?? 'Metric points'}
          value={stats.metricPointCount}
          accent={stats.metricPointCount > 0 ? 'text-brand' : undefined}
          tooltip={metricPointsTooltip(stats)}
          detail={metricPointsDetail(stats)}
          to={anomaliesLinks.metricPoints}
        />
        <StatCard
          label={statLabels?.dismissed ?? 'Dismissed'}
          value={stats.dismissedAnomalies}
          accent={stats.dismissedAnomalies > 0 ? 'text-fg-muted' : undefined}
          tooltip={dismissedAnomaliesTooltip(stats)}
          detail={dismissedAnomaliesDetail()}
          to={anomaliesLinks.dismissed}
        />
      </MetricStrip>
    </Section>
  )
}
