/**
 * FILE: apps/admin/src/lib/sidebarTree.ts
 * PURPOSE: Where every console page sits in the sidebar (owner, 2026-10-27:
 *          "some of the pages and subpages are not showing on the sidebar").
 *
 *          - Core pages (BUILDER_CORE_NAV_PATHS) are always listed.
 *          - A core page with sub-pages and no tab strip of its own lists them
 *            under itself while you are on it or on one of them (NAV_CHILDREN),
 *            so /qa-coverage shows Checks › Scheduled tests instead of nothing
 *            highlighted.
 *          - Every other page is under "More pages", grouped by the cycle
 *            sections (ADR 0027). A Lab the user keeps in the sidebar leaves
 *            that list.
 *
 *          sidebarTree.test.ts proves every sidebar-eligible registry page has
 *          a place, so a new page cannot go missing again.
 */

import { LAB_FEATURES } from './labs'
import {
  BUILDER_CORE_NAV_PATHS,
  CHECK_GROUPS,
  CHECK_SUB_GROUPS,
  NAV_REGISTRY,
  NAV_SECTION_META,
  type NavRegistryEntry,
  type NavSectionId,
} from './navRegistry'

/**
 * Sub-pages listed under a core page while you are in that family. Only for
 * pages that do not switch views with tabs of their own: Home and Team show
 * their views as a tab strip at the top of the page, and listing them again in
 * the sidebar repeated every tab (owner walk, 2026-10-28).
 */
export const NAV_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  '/portfolio': ['/projects'],
  '/checks': CHECK_GROUPS.flatMap((g) => g.paths),
}

/**
 * Headed groups for a parent's sub-pages. Checks used to list 13 pages in one
 * flat run that mixed the user's app, their CI and Mushi Mushi itself
 * (owner, 2026-11-19); the sidebar now prints each group's title above it.
 */
export const NAV_CHILD_GROUPS: Readonly<Record<string, ReadonlyArray<{ id: string; title: string; paths: readonly string[] }>>> = {
  '/checks': CHECK_GROUPS.map((g) => ({ id: g.id, title: CHECK_SUB_GROUPS[g.id].title, paths: g.paths })),
}

/** Pages the sidebar footer links to itself, so "More pages" leaves them out. */
const FOOTER_NAV_PATHS: readonly string[] = ['/feedback']

const SECTION_ORDER: readonly NavSectionId[] = ['start', 'plan', 'do', 'check', 'act', 'workspace']

export interface SidebarViewer {
  isOperator: boolean
  isSuperAdmin: boolean
}

function visibleToViewer(entry: Pick<NavRegistryEntry, 'superAdmin' | 'operatorOnly'>, viewer: SidebarViewer): boolean {
  return (!entry.superAdmin || viewer.isSuperAdmin) && (!entry.operatorOnly || viewer.isOperator)
}

/**
 * Whether a nav path is the page you are on. A path with `?view=` or `?tab=`
 * matches only that view; a bare path matches itself and anything under it.
 */
export function isNavPathActive(pathname: string, search: string, navPath: string): boolean {
  const [base, query] = navPath.split('?') as [string, string | undefined]
  const onBase = base === '/' ? pathname === '/' : pathname === base || pathname.startsWith(`${base}/`)
  if (!onBase) return false
  if (!query) return true
  const want = new URLSearchParams(query)
  const have = new URLSearchParams(search)
  for (const [key, value] of want) if (have.get(key) !== value) return false
  return true
}

/** The core page whose family the current page belongs to, if any. */
export function activeParent(pathname: string, search: string): string | null {
  for (const [parent, children] of Object.entries(NAV_CHILDREN)) {
    if (isNavPathActive(pathname, search, parent)) return parent
    if (children.some((child) => isNavPathActive(pathname, search, child))) return parent
  }
  return null
}

const CHILD_PATHS: ReadonlySet<string> = new Set(Object.values(NAV_CHILDREN).flat())

/** A headed run of sub-pages under a page in More pages (Checks › Your app, …); `title` null = no heading. */
interface MorePagesChildGroup {
  id: string
  title: string | null
  entries: NavRegistryEntry[]
}

export interface MorePagesGroup {
  sectionId: NavSectionId
  title: string
  entries: NavRegistryEntry[]
  /**
   * Sub-pages of a page listed here, keyed by that page's path. A sub-page
   * used to be dropped whenever its page HAD a parent, even when that parent
   * was itself only under More pages (ADR 0069 unpinned Checks and Apps), so
   * the 13 checks and Manage apps had no row at all (owner, 2026-11-28:
   * "some pages are not displayed on the side bar"). They now sit under
   * their page here.
   */
  children: Readonly<Record<string, MorePagesChildGroup[]>>
}

/**
 * Every page that has no place in the sidebar right now, by section: not
 * core, not a sub-page of a page that IS in the sidebar, not a Lab kept in
 * the sidebar, not a footer link, and one the viewer may open. A sub-page of
 * a page that is under More pages is listed under that page (`children`).
 */
export function morePages(viewer: SidebarViewer, pinnedLabIds: ReadonlySet<string>): MorePagesGroup[] {
  const pinned = new Set(
    LAB_FEATURES.filter((f) => pinnedLabIds.has(f.id)).map((f) => f.paths[0]),
  )
  // The core is the five builder pages for every account (ADR 0069): Apps,
  // Integrations, Checks, Team, Pipeline and Journeys are here unless their
  // Lab is on.
  const core = new Set(BUILDER_CORE_NAV_PATHS)
  const inSidebar = (path: string) => core.has(path) || pinned.has(path)
  const placeable = (e: NavRegistryEntry) =>
    e.inSidebar !== false &&
    !inSidebar(e.path) &&
    !FOOTER_NAV_PATHS.includes(e.path) &&
    visibleToViewer(e, viewer)
  // A sub-page whose page is in the sidebar is listed under it there (Layout).
  const childOfSidebarPage = (path: string) =>
    Object.entries(NAV_CHILDREN).some(([parent, kids]) => kids.includes(path) && inSidebar(parent))
  const hidden = NAV_REGISTRY.filter((e) => placeable(e) && !CHILD_PATHS.has(e.path))
  const byPath = new Map(NAV_REGISTRY.map((e) => [e.path, e] as const))
  const childrenFor = (parent: string): MorePagesChildGroup[] => {
    const pick = (paths: readonly string[]) =>
      paths
        .map((p) => byPath.get(p))
        .filter((e): e is NavRegistryEntry => e != null && placeable(e) && !childOfSidebarPage(e.path))
    const groups = NAV_CHILD_GROUPS[parent]
    const out = groups
      ? groups.map((g) => ({ id: g.id, title: g.title, entries: pick(g.paths) }))
      : [{ id: parent, title: null, entries: pick(NAV_CHILDREN[parent] ?? []) }]
    return out.filter((g) => g.entries.length > 0)
  }
  return SECTION_ORDER.map((sectionId) => {
    const entries = hidden.filter((e) => e.sectionId === sectionId)
    const children: Record<string, MorePagesChildGroup[]> = {}
    for (const e of entries) {
      if (!NAV_CHILDREN[e.path]) continue
      const groups = childrenFor(e.path)
      if (groups.length > 0) children[e.path] = groups
    }
    return { sectionId, title: NAV_SECTION_META[sectionId].title, entries, children }
  }).filter((g) => g.entries.length > 0)
}

/**
 * Every path More pages lists, sub-pages included.
 * @internal Exported for tests.
 */
export function morePagePaths(groups: readonly MorePagesGroup[]): string[] {
  return groups.flatMap((g) => [
    ...g.entries.map((e) => e.path),
    ...Object.values(g.children).flatMap((cg) => cg.flatMap((c) => c.entries.map((e) => e.path))),
  ])
}
