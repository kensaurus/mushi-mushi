/**
 * FILE: apps/admin/src/lib/mcpPageTitle.ts
 * PURPOSE: Browser-tab title for /mcp. The page name leads so a tab named
 *          Overview does not bury "Editor agents".
 */

/** `Editor agents · Overview` — the page name is the first thing in the tab. */
export function mcpPageContextTitle(tabLabel: string): string {
  return `Editor agents · ${tabLabel}`
}
