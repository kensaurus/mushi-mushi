/**
 * Per-route PageHelp read receipts — yellow banner until opened once.
 */

const READ_PREFIX = 'mushi:pagehelp:read:'

export function pageHelpReadKey(routeKey: string): string {
  return READ_PREFIX + routeKey
}

export function isPageHelpRead(routeKey: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(pageHelpReadKey(routeKey)) === '1'
  } catch {
    return false
  }
}

export function markPageHelpRead(routeKey: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(pageHelpReadKey(routeKey), '1')
    window.dispatchEvent(new CustomEvent('mushi:pagehelp-read', { detail: routeKey }))
  } catch {
    /* private mode */
  }
}

export const PAGEHELP_READ_EVENT = 'mushi:pagehelp-read'
