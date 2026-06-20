/**
 * FILE: pageLayout.ts
 * PURPOSE: Route-aware page width tokens for the admin shell.
 *
 * OVERVIEW:
 * - Marks canvas / atlas routes that should consume the full main column
 * - Keeps standard CRUD pages on the readable 92rem cap
 *
 * USAGE:
 * - Layout reads `pageLayoutWidthForPath(pathname)` for the inner container
 */

/** Routes that benefit from full-width workbench layouts (maps, chat, graphs). */
const FLUID_WIDTH_PREFIXES = ['/explore', '/graph'] as const

export type PageLayoutWidth = 'standard' | 'fluid'

export function pageLayoutWidthForPath(pathname: string): PageLayoutWidth {
  if (FLUID_WIDTH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return 'fluid'
  }
  return 'standard'
}

export const PAGE_SHELL_CLASS: Record<PageLayoutWidth, string> = {
  standard: 'w-full max-w-[min(100%,92rem)] mx-auto px-4 sm:px-5 py-4',
  fluid:
    'w-full max-w-none mx-auto px-3 sm:px-4 lg:px-5 xl:px-6 py-3 sm:py-4 motion-safe:transition-[padding] motion-safe:duration-base',
}

/** Full-width page body stack — matches shell padding, no extra horizontal inset. */
export const PAGE_CONTENT_STACK = 'flex w-full min-w-0 flex-col gap-4'

/** Chrome posture slot stack — alias used by PagePosture above primary work UI. */
export const PAGE_STACK = PAGE_CONTENT_STACK
