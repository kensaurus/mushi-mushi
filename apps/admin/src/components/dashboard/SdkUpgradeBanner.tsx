/**
 * Dashboard nudge — shown lazily after initial paint when the active
 * project's SDK is `outdated` or `deprecated`.  A single quiet banner
 * with a link to the Connect & Update hub so operators can act without
 * navigating to the projects list.
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../../lib/usePageData'
import { IconBolt } from '../icons'
import type { SdkStatus } from '../SdkVersionBadge'

interface ProjectSdkRow {
  id: string
  sdk_status?: SdkStatus
  sdk_version?: string | null
  sdk_latest_version?: string | null
}

interface ProjectsPayload {
  projects: ProjectSdkRow[]
}

export function SdkUpgradeBanner({ projectId }: { projectId: string }) {
  const { data } = usePageData<ProjectsPayload>('/v1/admin/projects')

  const project = data?.projects.find((p) => p.id === projectId)
  const stale =
    project?.sdk_status === 'outdated' || project?.sdk_status === 'deprecated'

  if (!stale) return null

  const from = project?.sdk_version ?? null
  const to = project?.sdk_latest_version ?? null
  const versionHint = from && to ? ` (v${from} → v${to})` : ''

  return (
    <div
      role="status"
      aria-label="SDK upgrade available"
      className="flex items-center gap-2 rounded-md border border-warn/25 bg-warn-muted px-3 py-2 text-xs"
    >
      <IconBolt className="h-3.5 w-3.5 text-warn shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 text-fg-secondary">
        SDK upgrade available{versionHint}.{' '}
        <Link to="/connect" className="text-accent-foreground underline hover:no-underline">
          Create Upgrade PR in Connect &amp; Update
        </Link>
      </span>
    </div>
  )
}
