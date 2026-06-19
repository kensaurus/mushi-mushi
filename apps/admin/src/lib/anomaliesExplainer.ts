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
    label: 'Z-score',
    plain: 'Flags values that jump far from the recent average — good for sudden error-rate spikes.',
    bestFor: 'Stable metrics with predictable variance (API 5xx rate, p95 latency).',
  },
  {
    id: 'page_hinkley',
    label: 'Page-Hinkley',
    plain: 'Detects sustained shifts after a deploy — catches gradual regressions Z-score might miss.',
    bestFor: 'Release regression watch on conversion or crash-free sessions.',
  },
  {
    id: 'ingest',
    label: 'Metric ingest',
    plain: 'Your app or CI posts time-series points via POST /v1/ingest/metrics. Detection cannot run until points exist.',
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

export function anomalyMethodDefinition(id: string): AnomalyMethodDefinition | undefined {
  return ANOMALY_METHOD_DEFINITIONS.find((m) => m.id === id)
}
