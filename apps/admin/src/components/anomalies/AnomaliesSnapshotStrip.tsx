/**
 * FILE: AnomaliesSnapshotStrip.tsx
 * PURPOSE: Unusual spikes status: did a metric jump, and did it start with a
 *          release (PageStatus, P1). With no metric data it is the page's one
 *          first step (PageFirstStep, P3).
 */

import { PageStatus } from '../ui'
import type { AnomaliesStats } from './AnomaliesStatsTypes'
import { pluralizeWithCount } from '../../lib/format'
import { anomaliesNoMetricsHint } from '../../lib/humanPageHints'
import { anomaliesLinks } from '../../lib/statCardLinks'

interface Props {
  stats: AnomaliesStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** Opens the metrics tab: the first step while no metric has arrived. */
  onAddMetrics?: () => void
}

function spikesSentence(stats: AnomaliesStats): string {
  if (stats.metricPointCount === 0) return 'No metric data yet.'
  if (stats.openAnomalies === 0) return `No unusual spikes across ${pluralizeWithCount(stats.distinctMetrics, 'metric')}.`
  const release = stats.releaseRegressionOpen > 0 ? `; ${stats.releaseRegressionOpen} started right after a release` : ''
  return `${pluralizeWithCount(stats.openAnomalies, 'unusual spike')} to confirm or dismiss${release}.`
}

export function AnomaliesSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, onAddMetrics }: Props) {
  return (
    <PageStatus
      ariaLabel="Unusual spikes status"
      tone={stats.releaseRegressionOpen > 0 || stats.highScoreOpen > 0 ? 'danger' : stats.openAnomalies > 0 ? 'warn' : 'ok'}
      sentence={spikesSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.open ?? 'Spikes to review',
          value: stats.openAnomalies,
          tone: stats.openAnomalies > 0 ? 'warn' : 'neutral',
          hint: 'Metric values far outside their normal range that nobody has confirmed or dismissed.',
          to: anomaliesLinks.open,
        },
        {
          label: statLabels?.releaseRegressions ?? 'After a release',
          value: stats.releaseRegressionOpen,
          tone: stats.releaseRegressionOpen > 0 ? 'danger' : 'neutral',
          hint: 'Spikes that started right after a release: the likeliest to be a regression.',
          to: anomaliesLinks.releaseRegressions,
        },
        {
          label: statLabels?.metricPoints ?? 'Metrics watched',
          value: stats.distinctMetrics,
          hint: 'Different metrics your app sends (error rate, latency, conversion…).',
          to: anomaliesLinks.metricPoints,
        },
      ]}
      empty={{
        title: 'No metric data yet',
        sentence: anomaliesNoMetricsHint(),
        action: onAddMetrics ? { label: 'Add metrics', onClick: onAddMetrics } : { label: 'Add metrics', to: '/health?view=spikes&tab=metrics' },
      }}
    />
  )
}
