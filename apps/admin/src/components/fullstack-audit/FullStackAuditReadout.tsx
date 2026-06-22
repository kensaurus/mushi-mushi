/**
 * FILE: FullStackAuditReadout.tsx
 * PURPOSE: Full-stack audit provenance — stats API ref and gate failure signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /fullstack-audit with error/warn/failed-gate posture
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - FullstackAuditStats from ./FullstackAuditStatsTypes
 *
 * USAGE:
 * - Mount on FullStackAuditPage with stats from GET /v1/admin/fullstack-audit/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { FullstackAuditStats } from './FullstackAuditStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: FullstackAuditStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function FullStackAuditReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/fullstack-audit/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Errors',
      value: String(stats.errorCount),
      tone: stats.errorCount > 0 ? 'danger' : 'ok',
    },
    {
      label: 'Warnings',
      value: String(stats.warnCount),
      tone: stats.warnCount > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Failed gates',
      value: String(stats.failedGateCount),
      tone: stats.failedGateCount > 0 ? 'danger' : 'ok',
    },
    {
      label: 'Priority',
      value: stats.topPriority,
      tone: stats.topPriority === 'healthy' ? 'ok' : stats.topPriority === 'failures' ? 'danger' : 'warn',
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
    <Section title="Full-stack audit readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Full-stack audit stats API" url={statsApi} />
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
