/**
 * FILE: ReleasesProvenanceReadout.tsx
 * PURPOSE: Release pipeline provenance — project ref and publish signals on /releases.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { ReleasesStats } from './ReleasesStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: ReleasesStats
  fetchedAt: string | null
  validating?: boolean
}

export function ReleasesProvenanceReadout({ stats, fetchedAt, validating }: Props) {
  if (!stats.projectId) return null

  const releasesApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/projects/${encodeURIComponent(stats.projectId)}/releases`

  const rows: DetailRowItem[] = [
    {
      label: 'Drafts pending',
      value: String(stats.draftCount),
      tone: stats.draftCount > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Published',
      value: String(stats.publishedCount),
      tone: stats.publishedCount > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Credits pending notify',
      value: String(stats.creditsPending),
      tone: stats.creditsPending > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Last published',
      value: stats.lastPublishedAt ?? 'Never',
      tone: stats.lastPublishedAt ? 'info' : 'muted',
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
    <Section title="Releases readout" freshness={{ at: fetchedAt, isValidating: validating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Releases API" url={releasesApi} />
          <div className="mt-2">
            <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          </div>
        </ReadoutSection>
        <ReadoutSection title="Pipeline signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
