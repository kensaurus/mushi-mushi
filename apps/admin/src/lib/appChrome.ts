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
 * Right-anchored drawer shell that starts below persistent top chrome.
 * Beta strip height is published by BetaBanner via ResizeObserver.
 */
export const drawerBelowAppChromeClass = [
  'fixed inset-x-0 bottom-0 z-50 flex justify-end',
  'top-[var(--mushi-beta-banner-offset,0px)]',
  `md:top-[calc(var(--mushi-beta-banner-offset,0px)+${DESKTOP_SUBHEADER_OFFSET})]`,
].join(' ')
