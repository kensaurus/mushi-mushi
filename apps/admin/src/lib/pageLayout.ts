/**
 * FILE: pageLayout.ts
 * PURPOSE: Route-aware page width tokens for the admin shell.
 *
 * OVERVIEW:
 * - Marks canvas / atlas routes that should consume the full main column
 * - Lets monitoring pages (tables, queues, timelines) use a desktop's width
 * - Keeps standard CRUD pages on the readable 92rem cap
 *
 * USAGE:
 * - Layout reads `pageLayoutWidthForPath(pathname)` for the inner container
 */

/** Routes that benefit from full-width workbench layouts (maps, chat, graphs). */
const FLUID_WIDTH_PREFIXES = ['/explore', '/graph'] as const

/**
 * Monitoring pages whose content is rows, lanes and time axes: more width is
 * more information (longer timelines, more columns), not longer lines of
 * prose. Most of the console's users are on desktop; at 92rem a 2560 px
 * screen left a third of the main column empty (owner, 2026-11-17). Each
 * route here was checked at 1440, 1920 and 2560 px before it was added.
 */
const WIDE_WIDTH_PREFIXES = ['/ci'] as const

export type PageLayoutWidth = 'standard' | 'wide' | 'fluid'

function matches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function pageLayoutWidthForPath(pathname: string): PageLayoutWidth {
  if (matches(pathname, FLUID_WIDTH_PREFIXES)) return 'fluid'
  if (matches(pathname, WIDE_WIDTH_PREFIXES)) return 'wide'
  return 'standard'
}

export const PAGE_SHELL_CLASS: Record<PageLayoutWidth, string> = {
  standard: 'w-full max-w-[min(100%,92rem)] mx-auto px-4 sm:px-5 py-4',
  // 160rem (2560 px) still stops an ultrawide monitor from spreading one table across 3440 px.
  wide: 'w-full max-w-[min(100%,160rem)] mx-auto px-4 sm:px-5 xl:px-6 py-4',
  fluid:
    'w-full max-w-none mx-auto px-3 sm:px-4 lg:px-5 xl:px-6 py-3 sm:py-4 motion-safe:transition-[transform,opacity] motion-safe:duration-base',
}

/** Full-width page body stack — matches shell padding, no extra horizontal inset. */
// The header bar keeps its own bottom margin for pages that are not a stack;
// inside one, the gap already spaces it, so the margin is dropped (a double
// 32px gap under every page title, owner 2026-10-30).
export const PAGE_CONTENT_STACK = 'flex w-full min-w-0 flex-col gap-4 [&>[data-page-header]]:mb-0'
