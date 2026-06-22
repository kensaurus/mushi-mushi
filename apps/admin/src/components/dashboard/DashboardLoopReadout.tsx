/**
 * FILE: DashboardLoopReadout.tsx
 * PURPOSE: PDCA loop provenance on dashboard — ingest endpoint + loop counters.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  projectId: string | null
  projectName: string | null
  openBacklog: number
  fixesInProgress: number
  fixesFailed: number
  openPrs: number
  fetchedAt: string | null
  isValidating?: boolean
}

export function DashboardLoopReadout({
  projectId,
  projectName,
  openBacklog,
  fixesInProgress,
  fixesFailed,
  openPrs,
  fetchedAt,
  isValidating,
}: Props) {
  if (!projectId) return null

  const rows: DetailRowItem[] = [
    {
      label: 'Active project',
      value: projectName ?? projectId,
      wrap: true,
    },
    {
      label: 'Project ref',
      value: projectId,
      mono: true,
      copyable: true,
      wrap: true,
    },
    {
      label: 'Open backlog',
      value: String(openBacklog),
      tone: openBacklog > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Fixes in flight',
      value: String(fixesInProgress),
      tone: fixesInProgress > 0 ? 'info' : 'muted',
    },
    {
      label: 'Failed fixes',
      value: String(fixesFailed),
      tone: fixesFailed > 0 ? 'danger' : 'muted',
    },
    {
      label: 'Open PRs',
      value: String(openPrs),
      tone: openPrs > 0 ? 'info' : 'muted',
    },
  ]

  return (
    <Section title="Loop readout" freshness={{ at: fetchedAt, isValidating }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Where reports land and how the active project&apos;s PDCA loop is moving right now.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Ingest API" url={RESOLVED_EXTERNAL_API_URL} />
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
