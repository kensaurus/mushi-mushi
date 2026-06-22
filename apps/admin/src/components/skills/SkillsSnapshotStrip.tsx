/**
 * FILE: SkillsSnapshotStrip.tsx
 * PURPOSE: Skill pipeline KPI strip using MetricStrip — backed by /v1/admin/skills/stats.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { SkillsStats } from './SkillsStatsTypes'

const skillsLinks = {
  catalog: '/skills?tab=catalog',
  activeRuns: '/skills?tab=pipelines',
  failedRuns: '/skills?tab=pipelines',
  awaitingCheckin: '/skills?tab=pipelines',
} as const

interface Props {
  stats: SkillsStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function SkillsSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'SKILLS SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="Skills snapshot">
        <StatCard
          label={statLabels?.catalog ?? 'Catalog'}
          value={stats.catalogTotal}
          accent={stats.catalogTotal > 0 ? 'text-brand' : undefined}
          hint="Synced agent skills available to attach to reports."
          detail="synced from GitHub sources"
          to={skillsLinks.catalog}
        />
        <StatCard
          label={statLabels?.activeRuns ?? 'Active runs'}
          value={stats.activeRuns}
          accent={stats.activeRuns > 0 ? 'text-brand' : undefined}
          hint="Pipeline runs currently executing skill steps."
          detail="live pipeline runs"
          to={skillsLinks.activeRuns}
        />
        <StatCard
          label={statLabels?.failedRuns ?? 'Failed runs'}
          value={stats.failedRuns}
          accent={stats.failedRuns > 0 ? 'text-danger' : 'text-ok'}
          hint="Pipeline runs that failed — open Pipelines tab for step errors."
          detail="needs operator review"
          to={skillsLinks.failedRuns}
        />
        <StatCard
          label={statLabels?.awaitingCheckin ?? 'Awaiting check-in'}
          value={stats.awaitingCheckin}
          accent={stats.awaitingCheckin > 0 ? 'text-warn' : undefined}
          hint="Handoff-mode steps paused until you mark them passed or failed."
          detail="handoff mode"
          to={skillsLinks.awaitingCheckin}
        />
      </MetricStrip>
    </Section>
  )
}
