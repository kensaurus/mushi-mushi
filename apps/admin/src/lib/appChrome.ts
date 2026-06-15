/**
 * FILE: apps/admin/src/lib/appChrome.ts
 * PURPOSE: Shared layout offsets for fixed overlays (drawers, panels)
 *          so they clear the beta banner and desktop sub-header.
 */

export const BETA_BANNER_ID = 'mushi-beta-banner'
export const BETA_BANNER_OFFSET_VAR = '--mushi-beta-banner-offset'

/** Desktop sub-header height (Search + toolbar row in Layout). */
export const DESKTOP_SUBHEADER_OFFSET = '2.25rem' /* tailwind top-9 */

/**
 * Stacking order for the authenticated shell.
 *
 * Without `appChromeMainClass` (`isolate` + `z-0`), descendants inside
 * `<main>` that set z-20/z-30 (e.g. PipelineStatusRibbon arrow pills)
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

/** Tailwind top offset shared by every fixed overlay below persistent chrome. */
export const topBelowAppChromeClass = [
  'top-[var(--mushi-beta-banner-offset,0px)]',
  `md:top-[calc(var(--mushi-beta-banner-offset,0px)+${DESKTOP_SUBHEADER_OFFSET})]`,
].join(' ')

/**
 * Right-anchored drawer shell that starts below persistent top chrome.
 * Beta strip height is published by BetaBanner via ResizeObserver.
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

/** Publish measured beta-banner height on :root for fixed overlays. */
export function setBetaBannerOffset(px: number) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty(BETA_BANNER_OFFSET_VAR, `${px}px`)
}
