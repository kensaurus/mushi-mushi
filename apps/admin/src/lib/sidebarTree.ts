/**
 * FILE: apps/admin/src/lib/sidebarTree.ts
 * PURPOSE: Where every console page sits in the sidebar (owner, 2026-10-27:
 *          "some of the pages and subpages are not showing on the sidebar").
 *
 *          - Core pages (CORE_NAV_PATHS) are always listed.
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
  CHECK_GROUPS,
  CORE_NAV_PATHS,
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
const CORE: ReadonlySet<string> = new Set(CORE_NAV_PATHS)

export interface MorePagesGroup {
  sectionId: NavSectionId
  title: string
  entries: NavRegistryEntry[]
}

/**
 * Every page that has no place in the sidebar right now, by section: not
 * core, not a core page's sub-page, not a Lab kept in the sidebar, not a
 * footer link, and one the viewer may open.
 */
export function morePages(viewer: SidebarViewer, pinnedLabIds: ReadonlySet<string>): MorePagesGroup[] {
  const pinned = new Set(
    LAB_FEATURES.filter((f) => pinnedLabIds.has(f.id)).map((f) => f.paths[0]),
  )
  const hidden = NAV_REGISTRY.filter(
    (e) =>
      e.inSidebar !== false &&
      !CORE.has(e.path) &&
      !CHILD_PATHS.has(e.path) &&
      !pinned.has(e.path) &&
      !FOOTER_NAV_PATHS.includes(e.path) &&
      visibleToViewer(e, viewer),
  )
  return SECTION_ORDER.map((sectionId) => ({
    sectionId,
    title: NAV_SECTION_META[sectionId].title,
    entries: hidden.filter((e) => e.sectionId === sectionId),
  })).filter((g) => g.entries.length > 0)
}
