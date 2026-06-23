/**
 * FILE: apps/admin/src/lib/searchIndex.ts
 * PURPOSE: Static index of everything the command palette can navigate to —
 *          derived from navRegistry so paths and keywords never drift from the
 *          sidebar. Palette matches via cmdk's built-in scorer + routeHaystack.
 */

import { buildStaticRoutes, type StaticRouteFromRegistry } from './navRegistry'

export type PaletteGroup = StaticRouteFromRegistry['group']

export type StaticRoute = StaticRouteFromRegistry

export const STATIC_ROUTES: StaticRoute[] = buildStaticRoutes()

export function routeHaystack(r: StaticRoute): string {
  return [r.label, r.group, r.description, ...r.keywords].join(' ').toLowerCase()
}
