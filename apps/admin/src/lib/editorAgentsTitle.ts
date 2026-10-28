/**
 * FILE: apps/admin/src/lib/editorAgentsTitle.ts
 * PURPOSE: Browser-tab title for Editor agents. The page name leads so a
 *          tab named Overview does not bury it.
 */

/** `Editor agents · Overview` — the page name is the first thing in the tab. */
export function editorAgentsPageTitle(tabLabel: string): string {
  return `Editor agents · ${tabLabel}`
}
