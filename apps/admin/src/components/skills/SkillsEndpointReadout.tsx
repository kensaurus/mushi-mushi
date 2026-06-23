/**
 * FILE: SkillsEndpointReadout.tsx
 * PURPOSE: API endpoints + project ref for /skills Sources tab — no KPI duplication
 *          with SkillsSnapshotStrip in PagePosture.
 *
 * OVERVIEW:
 * - Endpoints-only readout (stats API + admin base + project ref)
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 *
 * USAGE:
 * - Mount on Sources tab with stats from GET /v1/admin/skills/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { SkillsStats } from './SkillsStatsTypes'
import { IconGlobe, IconIntegrations } from '../icons'

interface Props {
  stats: SkillsStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function SkillsEndpointReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/skills/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Project ref',
      value: stats.projectId,
      mono: true,
      copyable: true,
      wrap: true,
    },
  ]

  return (
    <Section title="API endpoints" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Skills stats API" url={statsApi} />
          <div className="mt-2">
            <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          </div>
        </ReadoutSection>
        <ReadoutSection title="Project" icon={<IconIntegrations size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
