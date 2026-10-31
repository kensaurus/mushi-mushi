/**
 * FILE: apps/admin/src/components/projects/ProjectsStatusBanner.tsx
 * PURPOSE: Workspace-level project health — ingest, SDK heartbeat, active context.
 */

import { Btn } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import { missingAppsAreNew } from '../../lib/newApps'
import type { ProjectsStats, ProjectsTabId } from './types'

interface Props {
  stats: ProjectsStats
  /** Active team from OrgSwitcher — shown in healthy/partial banners. */
  activeTeamName?: string | null
  /** Viewer/member guidance when destructive actions are hidden. */
  roleHint?: string | null
  onTab?: (tab: ProjectsTabId) => void
  /** The open tab: on `create` the form is right below, so no second "Create project" button. */
  activeTab?: ProjectsTabId
  onRefresh?: () => void
  refreshing?: boolean
}

function tabFromPath(path: string | null): ProjectsTabId | null {
  if (!path) return null
  const tab = new URL(path, 'http://local').searchParams.get('tab')
  if (tab === 'list' || tab === 'create' || tab === 'overview') return tab
  return null
}

export function ProjectsStatusBanner({ stats, activeTeamName, roleHint, onTab, activeTab, onRefresh, refreshing }: Props) {
  const priority = stats.topPriority
  const label = stats.topPriorityLabel
  const actionTab = tabFromPath(stats.topPriorityTo)
  const viewing = stats.activeProjectName
  const teamPrefix = activeTeamName ? `Team ${activeTeamName}` : null
  const contextSuffix = [teamPrefix, viewing ? `viewing ${viewing}` : null].filter(Boolean).join(' · ')

  if (priority === 'no_projects') {
    return (
      <StatusBannerShell
        tone="info"
        title="No projects in this workspace yet"
        subtitle={roleHint ?? label}
        action={
          // A first-time user test (2026-10-29) clicked this twice on the
          // create tab, where it only re-opened the tab it was on.
          roleHint || activeTab === 'create' ? undefined : onTab ? (
            <Btn size="sm" variant="primary" onClick={() => onTab('create')}>Create project</Btn>
          ) : (
            <Btn to="/projects?tab=create" size="sm" variant="primary">Create project</Btn>
          )
        }
      />
    )
  }

  // Every app without a heartbeat was made today: setup to finish, not a
  // fault, whether or not a test report has landed (live journey 2026-10-30).
  const missing = stats.sdkMissingProjects ?? []
  const missingCount = stats.sdkMissingCount ?? missing.length
  if (
    (priority === 'never_ingested' || priority === 'no_sdk_heartbeat' || priority === 'sdk_missing') &&
    missingAppsAreNew(missing, missingCount)
  ) {
    const first = missing[0]!
    return (
      <StatusBannerShell
        tone="info"
        title={
          missingCount === 1
            ? `${first.name} is waiting for its first SDK heartbeat`
            : `${missingCount} new apps are waiting for their first SDK heartbeat`
        }
        subtitle="Install the SDK and open the app once; it checks in on its own."
        action={
          <Btn to={`/connect?project=${encodeURIComponent(first.id)}#connect-sdk-health`} size="sm" variant="primary" data-testid="projects-sdk-fix">
            Finish setting up {first.name}
          </Btn>
        }
      />
    )
  }

  if (priority === 'never_ingested') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.projectCount} project${stats.projectCount === 1 ? '' : 's'} — none have ingested yet`}
        subtitle={label}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('list')}>Open project list</Btn>
          ) : actionTab ? (
            <Btn to={stats.topPriorityTo ?? '/projects?tab=list'} size="sm" variant="ghost">Open project list</Btn>
          ) : null
        }
      />
    )
  }

  if (priority === 'no_sdk_heartbeat') {
    return (
      <StatusBannerShell
        tone="warn"
        title="Reports landing — no SDK heartbeat yet"
        subtitle={label}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('list')}>Debug keys</Btn>
          ) : null
        }
      />
    )
  }

  if (priority === 'sdk_missing') {
    const missing = stats.sdkMissingProjects ?? []
    const count = stats.sdkMissingCount ?? missing.length
    return (
      <StatusBannerShell
        tone="warn"
        title={
          missing.length === 1 && count === 1
            ? `${missing[0]!.name} has no SDK heartbeat`
            : `${count} projects have no SDK heartbeat`
        }
        subtitle={label}
        action={
          stats.topPriorityTo ? (
            <Btn to={stats.topPriorityTo} size="sm" variant="primary" data-testid="projects-sdk-fix">
              {missing.length > 0 ? `Fix ${missing[0]!.name}` : 'Fix it'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (priority === 'partial_ingest') {
    return (
      <StatusBannerShell
        tone="info"
        title={`${stats.neverIngestedCount} project${stats.neverIngestedCount === 1 ? '' : 's'} never ingested`}
        subtitle={
          <>
            {label}
            {contextSuffix ? ` · ${contextSuffix}` : ''}
          </>
        }
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('list')}>View projects</Btn>
          ) : null
        }
      />
    )
  }

  // Healthy needs no banner: the Overview tab and the tiles say it, and the
  // page said "All projects ingesting" up to three times (console sweep).
  if (priority === 'healthy') return null

  return (
    <StatusBannerShell
      tone="ok"
      title="All projects ingesting"
      subtitle={
        <>
          {label}
          {viewing ? ` · viewing ${viewing}` : ''}
        </>
      }
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            Refresh
          </Btn>
        ) : (
          <Btn to="/reports" size="sm" variant="ghost">Open Reports</Btn>
        )
      }
    />
  )
}
