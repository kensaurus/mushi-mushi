/**
 * FILE: ChromeBreadcrumb.tsx
 * PURPOSE: Breadcrumb trail in the desktop top bar, following the sidebar the
 *          user sees (lib/sidebarTree.ts):
 *            - a core page is one crumb: "Bugs", "Settings";
 *            - a page listed under a core page is "Parent › Page":
 *              "Home › Overview", "Checks › Scheduled tests";
 *            - a page under "More pages" keeps its group: "Bugs › Bug clusters".
 *          Routes outside the sidebar keep "Console".
 *
 * Until 2026-10-28 every page took its cycle section (ADR 0027), which the
 * flat sidebar no longer shows: Home read "Bugs › Home", Bugs "Bugs › Bugs",
 * Content checks "Verify › Content checks".
 *
 * The project segment was dropped: the project switcher in the same row
 * already names the project, and in the 224px slot the three segments
 * truncated each other at 1440px ("Console / solo-boss-c… / Inb…").
 */

import { Link, useLocation } from 'react-router-dom'
import { CORE_NAV_PATHS, NAV_REGISTRY, routeFallbackTitle, routeSection } from '../lib/navRegistry'
import { NAV_CHILDREN, activeParent, isNavPathActive } from '../lib/sidebarTree'

function registryLabel(path: string): string | null {
  return NAV_REGISTRY.find((e) => e.path === path)?.label ?? null
}

interface Trail {
  parent: { label: string; to: string | null } | null
  current: string
}

function breadcrumbTrail(pathname: string, search: string): Trail {
  const parent = activeParent(pathname, search)
  if (parent) {
    const child = (NAV_CHILDREN[parent] ?? []).find((c) => isNavPathActive(pathname, search, c))
    const parentLabel = registryLabel(parent) ?? routeFallbackTitle(parent) ?? 'Console'
    if (!child) return { parent: null, current: parentLabel }
    return { parent: { label: parentLabel, to: parent }, current: registryLabel(child) ?? routeFallbackTitle(pathname) ?? 'Console' }
  }
  const title = routeFallbackTitle(pathname)
  // A page the console does not know (the 404 page) read "Console › Console".
  if (!title) return { parent: null, current: 'Console' }
  if (CORE_NAV_PATHS.includes(pathname)) return { parent: null, current: title }
  const section = routeSection(pathname)
  return { parent: { label: section?.title ?? 'Console', to: section ? null : '/dashboard' }, current: title }
}

export function ChromeBreadcrumb() {
  const { pathname, search } = useLocation()
  const { parent, current } = breadcrumbTrail(pathname, search)

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden xl:flex items-center gap-1.5 min-w-0 max-w-64 text-2xs text-fg-muted shrink"
    >
      {parent ? (
        <>
          {parent.to ? (
            <Link
              to={parent.to}
              className="inline-flex min-h-6 items-center hover:text-fg motion-safe:transition-opacity shrink-0"
            >
              {parent.label}
            </Link>
          ) : (
            <span className="inline-flex min-h-6 items-center shrink-0">{parent.label}</span>
          )}
          <span aria-hidden className="text-fg-faint">›</span>
        </>
      ) : null}
      <span className="text-fg-secondary font-medium truncate" aria-current="page" title={current}>
        {current}
      </span>
    </nav>
  )
}
