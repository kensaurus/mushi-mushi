/**
 * FILE: LessonsReadout.tsx
 * PURPOSE: Lessons learned provenance — stats API ref and cluster/lesson posture signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /lessons with catalog and promotion readiness signals
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - LessonsStats from ./LessonsStatsTypes
 *
 * USAGE:
 * - Mount on LessonsPage with stats from GET /v1/admin/lessons/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { LessonsStats } from './LessonsStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: LessonsStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function LessonsReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/lessons/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Active lessons',
      value: `${stats.activeLessons} · ${stats.criticalLessons} critical`,
      tone: stats.criticalLessons > 0 ? 'danger' : stats.activeLessons > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Clusters',
      value: `${stats.candidateClusters} candidates · ${stats.promotedClusters} promoted`,
      tone: stats.readyToPromote > 0 ? 'warn' : stats.candidateClusters > 0 ? 'info' : 'muted',
    },
    {
      label: 'Ready to promote',
      value: String(stats.readyToPromote),
      tone: stats.readyToPromote > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Cluster reports',
      value: String(stats.totalClusterReports),
      tone: stats.totalClusterReports > 0 ? 'info' : 'muted',
    },
    {
      label: 'Last reinforced',
      value: stats.lastLessonReinforcedAt ?? 'Never',
      tone: stats.lastLessonReinforcedAt ? 'ok' : 'muted',
    },
    {
      label: 'Priority',
      value: stats.topPriorityLabel ?? stats.topPriority,
      tone: stats.topPriority === 'healthy' ? 'ok' : stats.topPriority === 'critical_lessons' ? 'danger' : 'warn',
      wrap: true,
    },
  ]

  return (
    <Section title="Lessons readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Lessons stats API" url={statsApi} />
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
