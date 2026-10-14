/**
 * FILE: ChromeBreadcrumb.tsx
 * PURPOSE: Breadcrumb trail in the desktop top bar: section › current route
 *          ("2 · Bugs › Bug clusters"), so a page says where it sits in the
 *          cycle (ADR 0027). Routes outside the sidebar keep "Console".
 *
 * The project segment was dropped: the project switcher in the same row
 * already names the project, and in the 224px slot the three segments
 * truncated each other at 1440px ("Console / solo-boss-c… / Inb…").
 */

import { Link, useLocation } from 'react-router-dom'
import { routeFallbackTitle, routeSection } from '../lib/navRegistry'

export function ChromeBreadcrumb() {
  const { pathname } = useLocation()
  const routeLabel = routeFallbackTitle(pathname) ?? 'Console'
  const section = routeSection(pathname)

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden xl:flex items-center gap-1.5 min-w-0 max-w-64 text-2xs text-fg-muted shrink"
    >
      <Link
        to={section?.firstPath ?? '/dashboard'}
        className="inline-flex min-h-6 items-center hover:text-fg motion-safe:transition-opacity shrink-0"
      >
        {section?.title ?? 'Console'}
      </Link>
      <span aria-hidden className="text-fg-faint">›</span>
      <span className="text-fg-secondary font-medium truncate" aria-current="page" title={routeLabel}>
        {routeLabel}
      </span>
    </nav>
  )
}
