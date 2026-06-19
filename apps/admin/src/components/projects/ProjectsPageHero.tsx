/**
 * Live Decide → Act → Verify hero for /projects — replaces the static
 * layout fallback with stats-backed metadata from GET /v1/admin/projects/stats.
 */

import { PageHero } from '../PageHero'
import type { PageHeroDecide, PageHeroVerify } from '../PageHero'
import type { PageAction } from '../PageActionBar'
import type { ProjectsStats } from './types'

function heroSeverity(stats: ProjectsStats): PageHeroDecide['severity'] {
  switch (stats.topPriority) {
    case 'healthy':
      return 'ok'
    case 'never_ingested':
    case 'no_sdk_heartbeat':
      return 'warn'
    case 'no_projects':
      return 'info'
    default:
      return 'neutral'
  }
}

function heroDecideLabel(stats: ProjectsStats): string {
  switch (stats.topPriority) {
    case 'healthy':
      return 'All projects ingesting'
    case 'never_ingested':
      return 'No ingest yet'
    case 'no_sdk_heartbeat':
      return 'No SDK heartbeat'
    case 'partial_ingest':
      return `${stats.neverIngestedCount} never ingested`
    case 'no_projects':
      return 'Empty workspace'
    default:
      return stats.topPriorityLabel ?? 'Projects'
  }
}

function heroMetric(stats: ProjectsStats): string {
  if (stats.projectCount === 0) return '0 projects'
  return `${stats.projectsWithReports}/${stats.projectCount} ingesting · ${stats.activeKeyCount} keys`
}

function heroAct(stats: ProjectsStats): PageAction | null {
  if (stats.topPriorityTo && stats.topPriorityLabel) {
    return {
      tone: stats.topPriority === 'healthy' ? 'idle' : 'act',
      title: stats.topPriorityLabel,
      primary: { kind: 'link', to: stats.topPriorityTo, label: 'Take action →' },
    }
  }
  if (stats.topPriority === 'healthy' && stats.activeProjectId) {
    return {
      tone: 'idle',
      title: `Viewing ${stats.activeProjectName ?? 'active project'}`,
      primary: {
        kind: 'link',
        to: `/projects?project=${stats.activeProjectId}&tab=list`,
        label: 'Open project →',
      },
    }
  }
  if (stats.topPriority === 'healthy') {
    return {
      tone: 'idle',
      title: 'Pipeline is healthy',
      primary: { kind: 'link', to: '/reports', label: 'Open Reports →' },
    }
  }
  return null
}

function heroVerify(stats: ProjectsStats): PageHeroVerify {
  const viewing = stats.activeProjectName
  return {
    label: viewing ? 'Active context' : 'No project selected',
    detail: viewing
      ? `${viewing} · ${stats.activeProjectHasReports ? 'ingesting' : 'no reports'} · ${
          stats.activeProjectSdkConnected ? 'SDK live' : 'no heartbeat'
        }`
      : 'Pick a project on the list tab — filters follow your selection.',
    to: stats.activeProjectId
      ? `/projects?project=${stats.activeProjectId}&tab=list`
      : '/projects?tab=list',
    secondaryTo: '/connect',
    secondaryLabel: 'Connect SDK',
    anchor: 'projects:verify',
    evidence: {
      kind: 'metric-breakdown',
      whyNow: stats.topPriorityLabel ?? 'Workspace project posture',
      items: [
        { label: 'Projects', value: stats.projectCount, tone: stats.projectCount > 0 ? 'ok' : 'warn' },
        {
          label: 'Ingesting',
          value: stats.projectsWithReports,
          tone: stats.projectsWithReports === stats.projectCount && stats.projectCount > 0 ? 'ok' : 'warn',
        },
        {
          label: 'SDK live',
          value: stats.sdkConnectedCount,
          tone: stats.sdkConnectedCount > 0 ? 'ok' : 'warn',
        },
        {
          label: 'Reports 24h',
          value: stats.reportsLast24h,
          tone: stats.reportsLast24h > 0 ? 'ok' : 'neutral',
        },
      ],
    },
  }
}

interface Props {
  stats: ProjectsStats
}

export function ProjectsPageHero({ stats }: Props) {
  return (
    <PageHero
      scope="projects"
      title="Projects"
      kicker="Workspace"
      decide={{
        label: heroDecideLabel(stats),
        metric: heroMetric(stats),
        summary:
          stats.topPriority === 'healthy'
            ? `${stats.projectCount} project${stats.projectCount === 1 ? '' : 's'} · ${stats.reportsLast24h} report${stats.reportsLast24h === 1 ? '' : 's'} in 24h · ${stats.staleKeyCount} stale key${stats.staleKeyCount === 1 ? '' : 's'}.`
            : stats.topPriorityLabel ??
              'Create a project, mint an API key, and confirm ingest before wiring the rest of the console.',
        severity: heroSeverity(stats),
        anchor: 'projects:decide',
        evidence: {
          kind: 'metric-breakdown',
          whyNow: stats.topPriorityLabel ?? undefined,
          items: [
            { label: 'Never ingested', value: stats.neverIngestedCount, tone: stats.neverIngestedCount > 0 ? 'warn' : 'ok' },
            { label: 'Stale keys', value: stats.staleKeyCount, tone: stats.staleKeyCount > 0 ? 'warn' : 'ok' },
            { label: 'Reports 30d', value: stats.reportsLast30d, tone: stats.reportsLast30d > 0 ? 'ok' : 'neutral' },
          ],
        },
      }}
      act={heroAct(stats)}
      actAnchor="projects:act"
      verify={heroVerify(stats)}
    />
  )
}
