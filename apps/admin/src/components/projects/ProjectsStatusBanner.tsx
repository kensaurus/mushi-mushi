/**
 * FILE: apps/admin/src/components/projects/ProjectsStatusBanner.tsx
 * PURPOSE: Workspace-level project health — ingest, SDK heartbeat, active context.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { ProjectsStats, ProjectsTabId } from './types'

interface Props {
  stats: ProjectsStats
  onTab?: (tab: ProjectsTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
}

function tabFromPath(path: string | null): ProjectsTabId | null {
  if (!path) return null
  const tab = new URL(path, 'http://local').searchParams.get('tab')
  if (tab === 'list' || tab === 'create' || tab === 'overview') return tab
  return null
}

export function ProjectsStatusBanner({ stats, onTab, onRefresh, refreshing }: Props) {
  const priority = stats.topPriority
  const label = stats.topPriorityLabel
  const actionTab = tabFromPath(stats.topPriorityTo)
  const viewing = stats.activeProjectName

  if (priority === 'no_projects') {
    return (
      <StatusBannerShell
        tone="info"
        title="No projects in this workspace yet"
        subtitle={label}
        action={
          onTab ? (
            <Btn size="sm" variant="primary" onClick={() => onTab('create')}>Create project</Btn>
          ) : (
            <Link to="/projects?tab=create">
              <Btn size="sm" variant="primary">Create project</Btn>
            </Link>
          )
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
            <Link to={stats.topPriorityTo ?? '/projects?tab=list'}>
              <Btn size="sm" variant="ghost">Open project list</Btn>
            </Link>
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

  if (priority === 'partial_ingest') {
    return (
      <StatusBannerShell
        tone="info"
        title={`${stats.neverIngestedCount} project${stats.neverIngestedCount === 1 ? '' : 's'} never ingested`}
        subtitle={
          <>
            {label}
            {viewing ? ` · viewing ${viewing}` : ''}
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
          <Link to="/reports">
            <Btn size="sm" variant="ghost">Open Reports</Btn>
          </Link>
        )
      }
    />
  )
}
