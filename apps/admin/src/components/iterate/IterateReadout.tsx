/**
 * FILE: IterateReadout.tsx
 * PURPOSE: PDCA iterate provenance — stats API ref and run queue/score signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /iterate with queued/running/failed PDCA posture
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - IterateStats from ./IterateStatsTypes
 *
 * USAGE:
 * - Mount on IteratePage with stats from GET /v1/admin/pdca/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { IterateStats } from './IterateStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: IterateStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function IterateReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/pdca/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Queue',
      value: `${stats.queued} queued · ${stats.running} running`,
      tone: stats.running > 0 ? 'ok' : stats.queued > 0 ? 'info' : 'muted',
    },
    {
      label: 'Outcomes',
      value: `${stats.succeeded} ok · ${stats.failed} failed · ${stats.aborted} aborted`,
      tone: stats.failed > 0 ? 'danger' : stats.succeeded > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Avg final score',
      value: stats.avgFinalScorePct != null ? `${stats.avgFinalScorePct.toFixed(1)}%` : '—',
      tone: stats.avgFinalScorePct != null ? 'info' : 'muted',
    },
    {
      label: 'Meeting target',
      value: String(stats.runsMeetingTarget),
      tone: stats.runsMeetingTarget > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Last run',
      value: stats.lastRunAt ?? 'Never',
      tone: stats.lastRunAt ? 'ok' : 'muted',
    },
    {
      label: 'Last failure',
      value: stats.lastFailedAt ? `${stats.lastFailedUrl ?? 'unknown URL'}` : 'None',
      tone: stats.lastFailedAt ? 'danger' : 'ok',
      wrap: true,
    },
  ]

  return (
    <Section title="Iterate readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="PDCA stats API" url={statsApi} />
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
