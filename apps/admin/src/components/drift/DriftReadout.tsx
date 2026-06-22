/**
 * FILE: DriftReadout.tsx
 * PURPOSE: Contract drift provenance — scanner API ref and open-finding signals.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { DriftStats } from './DriftStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

export interface DriftReadoutProps {
  stats: DriftStats
  fetchedAt: string | null
  validating?: boolean
}

export function DriftReadout({ stats, fetchedAt, validating }: DriftReadoutProps) {
  if (!stats.projectId) return null

  const rows: DetailRowItem[] = [
    {
      label: 'Open findings',
      value: `${stats.openFindings} (${stats.criticalOpen} critical · ${stats.warnOpen} warn)`,
      tone: stats.criticalOpen > 0 ? 'danger' : stats.openFindings > 0 ? 'warn' : 'ok',
      wrap: true,
    },
    {
      label: 'Snapshots',
      value: `${stats.snapshotCount} · ${stats.lastSnapshotEdges} edges last`,
      tone: stats.snapshotCount > 0 ? 'info' : 'muted',
    },
    {
      label: 'Edge delta',
      value: stats.edgeCountDelta != null ? String(stats.edgeCountDelta) : '—',
      tone: stats.edgeCountDelta != null && stats.edgeCountDelta !== 0 ? 'warn' : 'muted',
    },
    {
      label: 'Surfaces with findings',
      value: String(stats.surfacesWithFindings),
      tone: stats.surfacesWithFindings > 0 ? 'warn' : 'ok',
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
    <Section title="Drift readout" freshness={{ at: fetchedAt, isValidating: validating }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Contract walker compares live API surfaces to snapshots. Use the Scanner tab to enqueue a fresh scan.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          <div className="mt-2 rounded-md border border-edge-subtle bg-surface-root/40 px-3 py-2">
            <p className="mb-1 text-3xs font-medium uppercase tracking-wider text-fg-faint">Drift API</p>
            <p className="font-mono text-2xs text-fg-secondary break-all">GET /v1/admin/drift/findings</p>
            <p className="mt-1 font-mono text-2xs text-fg-secondary break-all">POST /v1/admin/drift/scan</p>
          </div>
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
