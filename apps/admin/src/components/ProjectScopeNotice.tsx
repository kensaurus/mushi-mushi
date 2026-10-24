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
  // Whether the line shows is known from the URL and the path, so it renders
  // at first paint; the app's name fills in when setup loads. Returning null
  // until then inserted the line late and pushed the page down 28px
  // (layout shift on /reports and /fixes, mushi-ux audit 2026-10-24).
  const name = setup.activeProject?.project_name ?? null
  return (
    <p className="mb-3 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted" role="status" data-testid="project-scope-notice">
      <span>
        This page shows one app at a time:{' '}
        {name ? (
          <span className="font-medium text-fg-secondary">{name}</span>
        ) : (
          <span aria-hidden="true" className="inline-block h-3 w-20 rounded-xs bg-surface-overlay/60 align-middle motion-safe:animate-pulse" />
        )}
        .
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
