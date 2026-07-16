/**
 * FILE: ChromeBreadcrumb.tsx
 * PURPOSE: Supabase-style breadcrumb trail in the desktop top bar —
 *          org / project / current route label.
 */

import { Link, useLocation } from 'react-router-dom'
import { routeFallbackTitle } from '../lib/navRegistry'
import { useActiveProjectId } from './ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'

export function ChromeBreadcrumb() {
  const { pathname } = useLocation()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name
  const routeLabel = routeFallbackTitle(pathname) ?? 'Console'

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden xl:flex items-center gap-1.5 min-w-0 max-w-[14rem] text-2xs text-fg-muted shrink"
    >
      <Link to="/dashboard" className="hover:text-fg motion-safe:transition-opacity truncate">
        Console
      </Link>
      {projectName && (
        <>
          <span aria-hidden className="text-fg-faint">/</span>
          <Link
            to="/projects"
            className="hover:text-fg motion-safe:transition-opacity truncate max-w-[8rem]"
            title={projectName}
          >
            {projectName}
          </Link>
        </>
      )}
      <span aria-hidden className="text-fg-faint">/</span>
      <span className="text-fg-secondary font-medium truncate" aria-current="page">
        {routeLabel}
      </span>
    </nav>
  )
}
