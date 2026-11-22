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

/** Views of a one-app page that still show every app. */
const ALL_APPS_HUB_VIEWS: Record<string, readonly string[]> = { '/dashboard': ['apps', 'growth'] }

/** @internal Exported for tests. */
export function isAllAppsHubView(pathname: string, search: string): boolean {
  const views = ALL_APPS_HUB_VIEWS[pathname]
  if (!views) return false
  const view = new URLSearchParams(search).get('view')
  return view != null && views.includes(view)
}

export function ProjectScopeNotice() {
  const { pathname, search } = useLocation()
  const mode = useProjectScopeMode()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  if (mode !== 'all' || allAppsSupportFor(pathname) !== 'single') return null
  // Hub views that cover every app (fresh-eyes 2026-11-18): Home's Overview lists all apps and
  // Growth is product-wide, so "one app at a time" contradicted the page.
  if (isAllAppsHubView(pathname, search)) return null
  // A team with no app yet, or the first-run screens: there is no app to name.
  // It read "This page shows one app at a time: ." (audit 2026-11-11), and
  // during project creation it named another team's app for a few seconds.
  if (pathname.startsWith('/onboarding')) return null
  if (!setup.loading && setup.data && setup.data.projects.length === 0) return null
  // Whether the line shows is known from the URL and the path, so it renders
  // at first paint; the app's name fills in when setup loads. Returning null
  // until then inserted the line late and pushed the page down 28px
  // (layout shift on /reports and /fixes, mushi-ux audit 2026-10-24).
  const name = setup.activeProject?.project_name ?? null
  return (
    <p
      // A banner, not a footnote: the header chip now names the same app, and
      // a grey hairline under it read as decoration (report ee6547f5).
      className="mb-3 flex flex-wrap items-center gap-x-1.5 rounded-md border border-edge-subtle/80 border-l-2 border-l-info/55 bg-info-muted px-2.5 py-2 text-xs text-fg-secondary"
      role="status"
      data-testid="project-scope-notice"
    >
      <span>
        This page shows one app at a time:{' '}
        {name ? (
          <span className="font-medium text-fg">{name}</span>
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
