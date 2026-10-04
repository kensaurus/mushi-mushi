/**
 * FILE: DashboardLoopReadout.tsx
 * PURPOSE: PDCA loop provenance on dashboard — ingest endpoint + loop counters.
 */

import { DisclosurePanel, Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import { IconGlobe, IconHealth } from '../icons'
import { useAdminMode } from '../../lib/mode'

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
  const { isAdvanced } = useAdminMode()
  if (!projectId) return null

  const rows: DetailRowItem[] = [
    {
      // The name, never the id: the full UUID led this card on every
      // dashboard (2026-10-04 audit). The id is in Developer details.
      label: 'Active project',
      value: projectName ?? 'Unnamed project',
      wrap: true,
    },
    {
      // Same measure as the "Triage backlog" KPI: every report still waiting for triage.
      // Overview's "unresolved" counts every report not yet fixed, so the
      // two numbers differ on purpose and must not share a name.
      label: 'Waiting to triage',
      value: String(openBacklog),
      tone: openBacklog > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Fixes in flight',
      value: String(fixesInProgress),
      tone: fixesInProgress > 0 ? 'info' : 'muted',
    },
    {
      label: 'Auto-fix stopped',
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
      <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
        <DetailRows items={rows} dense />
      </ReadoutSection>
      {/* Raw endpoints are for debugging an install, not for reading the
          loop, so they stay closed and out of Quick/Beginner modes. */}
      {isAdvanced && (
        <div className="mt-4">
          <DisclosurePanel title="Developer details">
            <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
              <EndpointCodeRow label="Ingest API" url={RESOLVED_EXTERNAL_API_URL} />
            </ReadoutSection>
            <div className="mt-3">
              <DetailRows
                items={[{ label: 'Project id', value: projectId, mono: true, copyable: true, wrap: true }]}
                dense
              />
            </div>
          </DisclosurePanel>
        </div>
      )}
    </Section>
  )
}
