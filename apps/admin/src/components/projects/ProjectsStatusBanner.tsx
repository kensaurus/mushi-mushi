/**
 * FILE: apps/admin/src/components/projects/ProjectsStatusBanner.tsx
 * PURPOSE: Workspace-level project health — ingest, SDK heartbeat, active context.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { ProjectsStats } from './types'

interface Props {
  stats: ProjectsStats
  activeProjectName: string | null
  onCreateTab?: () => void
}

export function ProjectsStatusBanner({ stats, activeProjectName, onCreateTab }: Props) {
  if (stats.projectCount === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No projects in this workspace yet</p>
            <p className="text-2xs text-fg-muted">
              Create a project, mint an API key, and send a test report — that proves ingest before you wire production traffic.
            </p>
          </div>
        </div>
        {onCreateTab ? (
          <Btn size="sm" variant="ghost" onClick={onCreateTab}>
            Create project
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.projectsWithReports === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.projectCount} project{stats.projectCount === 1 ? '' : 's'} — none have ingested a report yet
            </p>
            <p className="text-2xs text-fg-muted">
              Mint a key on a project card, paste it into the SDK, then use <strong>Test report</strong> or submit from your app.
            </p>
          </div>
        </div>
        <Link to="/reports">
          <Btn size="sm" variant="ghost">Open Reports</Btn>
        </Link>
      </div>
    )
  }

  if (stats.sdkConnectedCount === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Reports are landing — no SDK heartbeat yet</p>
            <p className="text-2xs text-fg-muted">
              Keys show &quot;never seen&quot; until the SDK calls ingest. Expand a project card to compare endpoint host vs this admin.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (stats.neverIngestedCount > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {stats.neverIngestedCount} project{stats.neverIngestedCount === 1 ? '' : 's'} never ingested
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.projectsWithReports} of {stats.projectCount} receiving reports · {stats.sdkConnectedCount} with SDK heartbeat
              {activeProjectName && stats.activeProjectId
                ? ` · viewing ${activeProjectName}${
                    stats.activeProjectHasReports ? '' : ' (no reports yet)'
                  }`
                : ''}
            </p>
          </div>
        </div>
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
            {stats.projectCount} project{stats.projectCount === 1 ? '' : 's'} · {stats.activeKeyCount} active key
            {stats.activeKeyCount === 1 ? '' : 's'} · {stats.reportsLast24h} report
            {stats.reportsLast24h === 1 ? '' : 's'} in 24h
            {activeProjectName && stats.activeProjectId ? ` · viewing ${activeProjectName}` : ''}
          </p>
        </div>
      </div>
      <Link to="/reports">
        <Btn size="sm" variant="ghost">Open Reports</Btn>
      </Link>
    </div>
  )
}
