/**
 * FILE: apps/admin/src/lib/pageTitle.ts
 * PURPOSE: One rule for a tabbed page's context title (pageContext `title`),
 *          which also titles the browser tab (lib/useDocumentTitle.ts).
 */

/**
 * A tabbed page's context title: the page's sidebar name, then the tab when
 * it is not the first one ("Reporter updates", "Reporter updates · Sent").
 * Tabs used to lead and the tab's description rode along as the summary, so
 * the browser tab read "Overview · Notifications · Messages your bug
 * reporters see i…" (console audit 2026-11-21).
 */
export function tabbedPageTitle(page: string, tabLabel: string, isFirstTab: boolean): string {
  return isFirstTab ? page : `${page} · ${tabLabel}`
}
