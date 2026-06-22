/**
 * FILE: QueryReadout.tsx
 * PURPOSE: NL query provenance — stats API ref, schema posture, and run signals on /query.
 *
 * OVERVIEW:
 * - Connect-style readout band with copyable endpoints and live query telemetry
 * - Surfaces schemaDegraded when the project schema cache is stale or incomplete
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - QueryStats from ./types
 *
 * USAGE:
 * - Mount on QueryPage overview tab with stats from GET /v1/admin/query/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { QueryStats } from './types'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: QueryStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function QueryReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/query/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Schema cache',
      value: stats.schemaDegraded ? 'Degraded — refresh schema tab' : 'Healthy',
      tone: stats.schemaDegraded ? 'danger' : 'ok',
    },
    {
      label: 'Runs (24h)',
      value: `${stats.runs24h} · ${stats.errors24h} errors`,
      tone: stats.errors24h > 0 ? 'warn' : stats.runs24h > 0 ? 'ok' : 'muted',
    },
    {
      label: 'NL vs raw',
      value: `${stats.nlRuns24h} NL · ${stats.rawRuns24h} raw`,
      tone: stats.runs24h > 0 ? 'info' : 'muted',
    },
    {
      label: 'Saved queries',
      value: `${stats.savedCount} personal · ${stats.teamSavedCount} team`,
      tone: stats.savedCount + stats.teamSavedCount > 0 ? 'info' : 'muted',
    },
    {
      label: 'Avg latency',
      value: stats.avgLatencyMs != null ? `${Math.round(stats.avgLatencyMs)} ms` : '—',
      tone: stats.avgLatencyMs != null ? 'info' : 'muted',
    },
    {
      label: 'Last run',
      value: stats.lastRunAt ?? 'No runs yet',
      tone: stats.lastRunAt ? 'ok' : 'muted',
      wrap: true,
    },
  ]

  return (
    <Section title="Query readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Query stats API" url={statsApi} />
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
