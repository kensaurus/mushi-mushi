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
  /**
   * Name of the project the console is viewing, as the page knows it from
   * the project list. Wins over `stats.activeProjectName`, which the stats
   * endpoint only fills when the request carried the project header and the
   * cached answer can lag a project switch.
   */
  activeProjectName?: string | null
}

export function ProjectsSnapshotStrip({
  stats,
  fetchedAt,
  isValidating,
  sectionTitle = 'Projects snapshot',
  hint,
  activeProjectName,
}: Props) {
  const viewingName = activeProjectName ?? stats.activeProjectName
  return (
    <Section title={sectionTitle} freshness={{ at: fetchedAt, isValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={3} ariaLabel="Projects snapshot primary" className="mb-2">
        <StatCard
          label="Projects"
          value={stats.projectCount}
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
          value={stats.projectCount > 0 ? `${stats.sdkConnectedCount}/${stats.projectCount}` : stats.sdkConnectedCount}
          accent={
            stats.sdkConnectedCount > 0 && stats.sdkConnectedCount === stats.projectCount
              ? 'text-ok'
              : stats.sdkConnectedCount > 0 || stats.projectsWithReports > 0
                ? 'text-warn'
                : undefined
          }
          hint="Projects whose SDK key checked in"
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
          value={viewingName ?? 'None'}
          hint={
            !viewingName
              ? 'Pick a project on list tab'
              : stats.activeProjectHasReports
                ? stats.activeProjectSdkConnected
                  ? 'Active project ingesting'
                  : 'Active project — no heartbeat'
                : 'Active project — no reports yet'
          }
        />
      </MetricStrip>
    </Section>
  )
}
