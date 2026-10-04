/**
 * FILE: apps/admin/src/lib/searchIndex.ts
 * PURPOSE: Static index of everything the command palette can navigate to —
 *          derived from navRegistry so paths and keywords never drift from the
 *          sidebar — plus the palette's ranking.
 *
 * Ranking is deliberately simple and predictable: an exact label or alias
 * beats a prefix, which beats a word inside a longer label, which beats a
 * description mention. cmdk's fuzzy scorer matched scattered letters across
 * the whole path + label + keywords + description string, so a search for
 * "api key" could surface unrelated pages above Settings.
 */

import { buildStaticRoutes, type StaticRouteFromRegistry } from './navRegistry'

export type PaletteGroup = StaticRouteFromRegistry['group']

export type StaticRoute = StaticRouteFromRegistry

export const STATIC_ROUTES: StaticRoute[] = buildStaticRoutes()

/**
 * The pages this viewer may open. Super-admin and operator pages 403 for
 * everyone else, and the sidebar already hides them, so the palette must too.
 * Plan-gated pages stay listed: they show their own upgrade prompt.
 */
export function paletteRoutesFor(
  viewer: { isSuperAdmin: boolean; isOperator: boolean },
  routes: readonly StaticRoute[] = STATIC_ROUTES,
): StaticRoute[] {
  return routes.filter(
    (r) => (!r.superAdmin || viewer.isSuperAdmin) && (!r.operatorOnly || viewer.isOperator),
  )
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** True when `q` starts at a word boundary in `text` (both normalized). */
function atWordStart(text: string, q: string): boolean {
  return ` ${text}`.includes(` ${q}`)
}

export interface PaletteSearchable {
  label: string
  aliases: readonly string[]
  description: string
}

/**
 * 0 = no match. Higher is better. Exact label 100, exact alias 92, label
 * prefix 88, a word in the label 80, alias prefix 76, a word in an alias 70,
 * every word of the query found in label/aliases 60, description 40/30.
 */
export function paletteMatchScore(query: string, item: PaletteSearchable): number {
  const q = normalize(query)
  if (!q) return 0
  const label = normalize(item.label)
  const aliases = item.aliases.map(normalize)
  const description = normalize(item.description)
  if (label === q) return 100
  if (aliases.includes(q)) return 92
  if (label.startsWith(q)) return 88
  if (atWordStart(label, q)) return 80
  if (aliases.some((a) => a.startsWith(q))) return 76
  if (aliases.some((a) => atWordStart(a, q))) return 70
  const words = q.split(' ')
  const names = [label, ...aliases]
  if (words.every((w) => names.some((n) => atWordStart(n, w)))) return 60
  if (atWordStart(description, q)) return 40
  if (words.every((w) => atWordStart(description, w) || names.some((n) => atWordStart(n, w)))) return 30
  return 0
}

/** Routes matching `query`, best first; ties keep registry (sidebar) order. */
export function rankPaletteRoutes(
  query: string,
  routes: readonly StaticRoute[] = STATIC_ROUTES,
): Array<{ route: StaticRoute; score: number }> {
  return routes
    .map((route, index) => ({
      route,
      index,
      score: paletteMatchScore(query, {
        label: route.label,
        aliases: route.keywords,
        description: route.description,
      }),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ route, score }) => ({ route, score }))
}

/** Score at or above which a page outranks live report results. */
export const STRONG_PAGE_MATCH = 60
