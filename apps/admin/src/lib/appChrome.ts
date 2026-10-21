/**
 * FILE: apps/admin/src/lib/appChrome.ts
 * PURPOSE: Shared layout offsets for fixed overlays (drawers, panels)
 *          so they clear the desktop sub-header (and the beta strip offset,
 *          which stays 0 since the strip was removed on 2026-10-20).
 */

export const BETA_BANNER_OFFSET_VAR = '--mushi-beta-banner-offset'

/**
 * Desktop sub-header height (Search + toolbar row in Layout).
 * @internal Exported for tests only.
 */
export const DESKTOP_SUBHEADER_OFFSET = 'var(--chrome-row-height,2.5rem)'

/**
 * Tailwind top offset shared by every fixed overlay below persistent chrome.
 *
 * Written out in full, with no spaces inside the brackets: Tailwind reads
 * class names from the source text, so a class built with `${…}` or holding
 * a space is never generated. Until 2026-10-22 the md: offset was built that
 * way, so every desktop drawer started at the top of the window and the
 * header covered its title.
 */
const topBelowAppChromeClass =
  'top-[var(--mushi-beta-banner-offset,0px)] md:top-[calc(var(--mushi-beta-banner-offset,0px)+var(--chrome-row-height,2.5rem))]'

/**
 * Stacking order for the authenticated shell.
 *
 * Without `appChromeMainClass` (`isolate` + `z-0`), descendants inside
 * `<main>` that set z-20/z-30 (e.g. sticky table headers, popovers)
 * participate in the *layout column's* root stacking context — same
 * level as the sub-header — and paint over header dropdowns because
 * `<main>` follows the header in DOM order.
 */
export const appChromeHeaderClass =
  'relative z-40 overflow-visible shrink-0 bg-surface-root/95 backdrop-blur-sm'
export const appChromeMainClass = 'relative z-0 isolate'

/** Shared panel surface for header switcher / version menus. */
export const headerDropdownPanelClass =
  'absolute right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-edge-subtle bg-surface-raised shadow-raised'

/**
 * Right-anchored drawer shell that starts below persistent top chrome.
 * The beta-strip offset variable is kept for the fixed overlays' math; nothing
 * publishes a non-zero value any more.
 */
export const drawerBelowAppChromeClass = [
  'fixed inset-x-0 bottom-0 z-50 flex justify-end',
  topBelowAppChromeClass,
].join(' ')

/** PDCA stage drawer — bottom sheet on mobile, right rail on desktop. */
export const stageDrawerBelowAppChromeClass = [
  'fixed inset-x-0 bottom-0 z-40 flex items-end sm:items-stretch sm:justify-end motion-safe:animate-mushi-drawer-backdrop-in',
  topBelowAppChromeClass,
].join(' ')

/** Mobile navigation overlay (left rail). */
export const mobileNavBelowAppChromeClass = [
  'fixed inset-x-0 bottom-0 z-40 md:hidden',
  topBelowAppChromeClass,
].join(' ')

