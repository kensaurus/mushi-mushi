/**
 * FILE: apps/admin/src/components/ProjectScopeNotice.tsx
 * PURPOSE: One line at the top of a page that shows one app while the header
 *          says "All apps" (lib/projectScope.ts). The page still renders that
 *          app's data as before; the line only says which app it is and how
 *          to pick another. Never an error, never an empty page. Rendered once
 *          by Layout, so no page has to remember it.
 */

import { useLocation } from 'react-router-dom'
import { useActiveProjectId } from './ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { allAppsSupportFor, requestOpenProjectSwitcher, useProjectScopeMode } from '../lib/projectScope'

export function ProjectScopeNotice() {
  const { pathname } = useLocation()
  const mode = useProjectScopeMode()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  if (mode !== 'all' || allAppsSupportFor(pathname) !== 'single') return null
  const name = setup.activeProject?.project_name
  if (!name) return null
  return (
    <p className="mb-3 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted" role="status" data-testid="project-scope-notice">
      <span>
        This page shows one app at a time: <span className="font-medium text-fg-secondary">{name}</span>.
      </span>
      <button
        type="button"
        onClick={requestOpenProjectSwitcher}
        className="text-link underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-xs"
      >
        Switch app
      </button>
    </p>
  )
}
