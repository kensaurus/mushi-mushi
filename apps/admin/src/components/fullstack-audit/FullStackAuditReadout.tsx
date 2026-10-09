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

import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection, ReadoutPanel } from '../readout'
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

  // A failed read leaves the counts unknown: never show them as a green 0.
  const unknown = stats.topPriority === 'unknown'
  const count = (n: number, bad: 'danger' | 'warn'): Pick<DetailRowItem, 'value' | 'tone'> =>
    unknown ? { value: '—', tone: 'warn' } : { value: String(n), tone: n > 0 ? bad : 'ok' }
  const rows: DetailRowItem[] = [
    { label: 'Errors', ...count(stats.errorCount, 'danger') },
    { label: 'Warnings', ...count(stats.warnCount, 'warn') },
    { label: 'Failed gates', ...count(stats.failedGateCount, 'danger') },
    {
      label: 'Priority',
      value: unknown ? `unknown: ${stats.readError ?? 'a read failed'}` : stats.topPriority,
      tone: stats.topPriority === 'healthy' ? 'ok' : stats.topPriority === 'failures' ? 'danger' : 'warn',
      wrap: unknown,
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
    <ReadoutPanel title="Full-stack audit readout" freshness={{ at: fetchedAt, isValidating }}>
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
    </ReadoutPanel>
  )
}
