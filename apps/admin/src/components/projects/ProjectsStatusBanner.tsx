/**
 * FILE: apps/admin/src/components/projects/ProjectsStatusBanner.tsx
 * PURPOSE: Workspace-level project health — ingest, SDK heartbeat, active context.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
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
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No projects in this workspace yet</p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="primary" onClick={() => onTab('create')}>Create project</Btn>
        ) : (
          <Link to="/projects?tab=create">
            <Btn size="sm" variant="primary">Create project</Btn>
          </Link>
        )}
      </div>
    )
  }

  if (priority === 'never_ingested') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.projectCount} project{stats.projectCount === 1 ? '' : 's'} — none have ingested yet
            </p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('list')}>Open project list</Btn>
        ) : actionTab ? (
          <Link to={stats.topPriorityTo ?? '/projects?tab=list'}>
            <Btn size="sm" variant="ghost">Open project list</Btn>
          </Link>
        ) : null}
      </div>
    )
  }

  if (priority === 'no_sdk_heartbeat') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Reports landing — no SDK heartbeat yet</p>
            <p className="text-2xs text-fg-muted">{label}</p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('list')}>Debug keys</Btn>
        ) : null}
      </div>
    )
  }

  if (priority === 'partial_ingest') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {stats.neverIngestedCount} project{stats.neverIngestedCount === 1 ? '' : 's'} never ingested
            </p>
            <p className="text-2xs text-fg-muted">
              {label}
              {viewing ? ` · viewing ${viewing}` : ''}
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('list')}>View projects</Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">All projects ingesting</p>
          <p className="text-2xs text-fg-muted">
            {label}
            {viewing ? ` · viewing ${viewing}` : ''}
          </p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          Refresh
        </Btn>
      ) : (
        <Link to="/reports">
          <Btn size="sm" variant="ghost">Open Reports</Btn>
        </Link>
      )}
    </div>
  )
}
