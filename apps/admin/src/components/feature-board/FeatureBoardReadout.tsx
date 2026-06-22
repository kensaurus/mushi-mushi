/**
 * FILE: FeatureBoardReadout.tsx
 * PURPOSE: Feature board provenance — list API ref and client-derived ticket count signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /feature-board using counts derived from loaded tickets
 * - Parent page computes open/shipped/vote totals from GET /v1/admin/feature-board
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - FeatureBoardClientStats from ./FeatureBoardStatsTypes
 *
 * USAGE:
 * - Mount on FeatureBoardPage with clientStats built from ticket list useMemo hooks
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { FeatureBoardClientStats } from './FeatureBoardStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: FeatureBoardClientStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function FeatureBoardReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const listApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/feature-board?project_id=${encodeURIComponent(stats.projectId)}`

  const rows: DetailRowItem[] = [
    {
      label: 'Open requests',
      value: String(stats.openCount),
      tone: stats.openCount > 0 ? 'info' : 'muted',
    },
    {
      label: 'Shipped',
      value: String(stats.shippedCount),
      tone: stats.shippedCount > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Total votes',
      value: String(stats.totalVotes),
      tone: stats.totalVotes > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Tickets loaded',
      value: String(stats.totalTickets),
      tone: stats.totalTickets > 0 ? 'info' : 'muted',
    },
    {
      label: 'Top request',
      value: stats.topRequestSubject ?? '—',
      tone: stats.topRequestSubject ? 'info' : 'muted',
      wrap: true,
    },
    {
      label: 'Project ref',
      value: stats.projectId,
      mono: true,
      copyable: true,
      wrap: true,
    },
  ]

  return (
    <Section title="Feature board readout" freshness={{ at: fetchedAt, isValidating }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Vote and status counts are derived from the loaded ticket list on this page, not the nav-meta stats slice.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Feature board list API" url={listApi} />
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
