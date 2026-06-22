/**
 * FILE: ProjectsSnapshotStrip.tsx
 * PURPOSE: Workspace KPI strip for Projects hub — MetricStrip-aligned StatCard grid.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { ProjectsStats } from './types'

interface Props {
  stats: ProjectsStats
  fetchedAt: string | null
  isValidating?: boolean
  sectionTitle?: string
  hint?: string
}

export function ProjectsSnapshotStrip({
  stats,
  fetchedAt,
  isValidating,
  sectionTitle = 'Projects snapshot',
  hint,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: fetchedAt, isValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={3} ariaLabel="Projects snapshot primary" className="mb-2">
        <StatCard
          label="Projects"
          value={stats.projectCount}
          accent={stats.projectCount > 0 ? 'text-brand' : undefined}
          hint="Apps or environments tracked"
        />
        <StatCard
          label="Ingesting"
          value={stats.projectsWithReports}
          accent={stats.projectsWithReports > 0 ? 'text-ok' : 'text-warn'}
          hint={`${stats.neverIngestedCount} never received a report`}
        />
        <StatCard
          label="SDK connected"
          value={stats.sdkConnectedCount}
          accent={
            stats.sdkConnectedCount > 0
              ? 'text-ok'
              : stats.projectsWithReports > 0
                ? 'text-warn'
                : undefined
          }
          hint="Projects with key heartbeat"
        />
      </MetricStrip>
      <MetricStrip cols={3} ariaLabel="Projects snapshot secondary">
        <StatCard
          label="Active keys"
          value={stats.activeKeyCount}
          accent={stats.activeKeyCount > 0 ? 'text-info' : undefined}
          hint={`${stats.staleKeyCount} never seen`}
        />
        <StatCard
          label="Reports · 24h"
          value={stats.reportsLast24h}
          accent={stats.reportsLast24h > 0 ? 'text-ok' : undefined}
          hint={`${stats.reportsLast30d} in 30 days`}
        />
        <StatCard
          label="Viewing"
          value={stats.activeProjectName ? 'Set' : 'None'}
          accent={stats.activeProjectId ? 'text-brand' : undefined}
          hint={
            stats.activeProjectHasReports
              ? stats.activeProjectSdkConnected
                ? 'Active project ingesting'
                : 'Active project — no heartbeat'
              : 'Pick a project on list tab'
          }
        />
      </MetricStrip>
    </Section>
  )
}
