/**
 * FILE: SkillsReadout.tsx
 * PURPOSE: Skill pipeline provenance — stats API ref and catalog/run posture signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /skills with catalog size and active pipeline runs
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - SkillsStats from ./SkillsStatsTypes
 *
 * USAGE:
 * - Mount on SkillsPage with stats from GET /v1/admin/skills/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { SkillsStats } from './SkillsStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: SkillsStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function SkillsReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/skills/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Catalog',
      value: `${stats.catalogTotal} skills synced`,
      tone: stats.catalogTotal > 0 ? 'ok' : 'warn',
    },
    {
      label: 'Active runs',
      value: String(stats.activeRuns),
      tone: stats.activeRuns > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Failed runs',
      value: String(stats.failedRuns),
      tone: stats.failedRuns > 0 ? 'danger' : 'ok',
    },
    {
      label: 'Awaiting check-in',
      value: String(stats.awaitingCheckin),
      tone: stats.awaitingCheckin > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Priority',
      value: stats.topPriorityLabel ?? stats.topPriority,
      tone: stats.topPriority === 'healthy' ? 'ok' : stats.topPriority === 'failed_runs' ? 'danger' : 'warn',
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
    <Section title="Skills readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Skills stats API" url={statsApi} />
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
