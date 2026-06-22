/**
 * FILE: AnomaliesReadout.tsx
 * PURPOSE: Anomaly detection provenance — stats API ref and open-finding signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /anomalies with metric coverage and detection posture
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - AnomaliesStats from ./AnomaliesStatsTypes
 *
 * USAGE:
 * - Mount on AnomaliesPage with stats from GET /v1/admin/anomalies/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { AnomaliesStats } from './AnomaliesStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: AnomaliesStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function AnomaliesReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/anomalies/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Open anomalies',
      value: `${stats.openAnomalies} · ${stats.highScoreOpen} high score`,
      tone: stats.openAnomalies > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Release regressions',
      value: String(stats.releaseRegressionOpen),
      tone: stats.releaseRegressionOpen > 0 ? 'danger' : 'ok',
    },
    {
      label: 'Confirmed / dismissed',
      value: `${stats.confirmedAnomalies} confirmed · ${stats.dismissedAnomalies} dismissed`,
      tone: stats.confirmedAnomalies > 0 ? 'info' : 'muted',
    },
    {
      label: 'Metrics ingested',
      value: `${stats.distinctMetrics} metrics · ${stats.metricPointCount} points`,
      tone: stats.metricPointCount > 0 ? 'info' : 'muted',
    },
    {
      label: 'Last detection',
      value: stats.lastDetectionAt ?? 'Never',
      tone: stats.lastDetectionAt ? 'ok' : 'muted',
    },
    {
      label: 'Auto-reported',
      value: String(stats.autoReported),
      tone: stats.autoReported > 0 ? 'info' : 'muted',
    },
  ]

  return (
    <Section title="Anomalies readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Anomalies stats API" url={statsApi} />
          <div className="mt-2">
            <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          </div>
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
