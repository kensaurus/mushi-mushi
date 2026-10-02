/**
 * FILE: ChromeBreadcrumb.tsx
 * PURPOSE: Breadcrumb trail in the desktop top bar: Console / current route.
 *
 * The project segment was dropped: the project switcher in the same row
 * already names the project, and in the 224px slot the three segments
 * truncated each other at 1440px ("Console / solo-boss-c… / Inb…").
 */

import { Link, useLocation } from 'react-router-dom'
import { routeFallbackTitle } from '../lib/navRegistry'

export function ChromeBreadcrumb() {
  const { pathname } = useLocation()
  const routeLabel = routeFallbackTitle(pathname) ?? 'Console'

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden xl:flex items-center gap-1.5 min-w-0 max-w-64 text-2xs text-fg-muted shrink"
    >
      <Link
        to="/dashboard"
        className="inline-flex min-h-6 items-center hover:text-fg motion-safe:transition-opacity shrink-0"
      >
        Console
      </Link>
      <span aria-hidden className="text-fg-faint">/</span>
      <span className="text-fg-secondary font-medium truncate" aria-current="page" title={routeLabel}>
        {routeLabel}
      </span>
    </nav>
  )
}
