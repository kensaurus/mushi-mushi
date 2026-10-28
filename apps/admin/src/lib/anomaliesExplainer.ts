/**
 * Plain-language metric anomaly detection guide.
 */

export interface AnomalyMethodDefinition {
  id: string
  label: string
  plain: string
  bestFor: string
}

export const ANOMALY_METHOD_DEFINITIONS: AnomalyMethodDefinition[] = [
  {
    id: 'zscore',
    label: 'Sudden jump',
    plain: 'Flags values that jump far from the recent average — good for sudden error-rate spikes.',
    bestFor: 'Stable metrics with predictable variance (API 5xx rate, p95 latency).',
  },
  {
    id: 'page_hinkley',
    label: 'Slow drift',
    plain: 'Notices a value that keeps creeping up after a deploy, which a sudden-jump check can miss.',
    bestFor: 'Release regression watch on conversion or crash-free sessions.',
  },
  {
    id: 'ingest',
    label: 'Your metrics',
    plain: 'Your app or CI sends values (error rate, latency…) to POST /v1/ingest/metrics. Mushi needs some values before it can spot a spike.',
    bestFor: 'Wire SDK or server heartbeat before expecting open anomalies.',
  },
]

export const ANOMALIES_EXPLAINER_SUMMARY =
  'Anomalies watch your ingested metrics for spikes and post-release regressions. Confirm real incidents, dismiss noise, or let high-confidence spikes auto-open bug reports.'

export function isAnomaliesGuideExpanded(topPriority: string | undefined): boolean {
  return (
    topPriority === 'no_project' ||
    topPriority === 'no_metrics' ||
    topPriority === 'open_critical' ||
    topPriority === 'open_anomalies'
  )
}
