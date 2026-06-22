/**
 * FILE: CodeHealthReadout.tsx
 * PURPOSE: Code health ingest provenance — CI metrics endpoint and gate posture.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { CodeHealthStats } from './CodeHealthStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

export interface CodeHealthReadoutProps {
  stats: CodeHealthStats
  fetchedAt?: string | null
  validating?: boolean
}

export function CodeHealthReadout({ stats, fetchedAt, validating }: CodeHealthReadoutProps) {
  if (!stats.projectId) return null

  const ingestUrl = `${RESOLVED_EXTERNAL_API_URL}/v1/ingest/metrics`

  const rows: DetailRowItem[] = [
    {
      label: 'God files',
      value: String(stats.godFileCount),
      tone: stats.godFileCount > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Findings',
      value: `${stats.errorCount} errors · ${stats.warnCount} warnings`,
      tone: stats.errorCount > 0 ? 'danger' : stats.warnCount > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Latest CI run',
      value: stats.latestRunAt ? new Date(stats.latestRunAt).toLocaleString() : 'No runs yet',
      tone: stats.hasRun ? 'ok' : 'muted',
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
    <Section title="Code health readout" freshness={{ at: fetchedAt ?? null, isValidating: validating }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Host CI posts bundle KB and god-file findings here via{' '}
        <code className="font-mono text-2xs">MUSHI_INGEST_KEY</code>. Separate from the in-app reporter SDK.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Metrics ingest" url={ingestUrl} />
          <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
