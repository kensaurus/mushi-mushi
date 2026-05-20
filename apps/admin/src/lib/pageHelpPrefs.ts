/**
 * User preference for PageHelp — "keep tips open on every page".
 * Persisted in localStorage; synced across tabs via custom event.
 */

const ALWAYS_OPEN_KEY = 'mushi:pagehelp:always-open'

export const PAGEHELP_PREFS_EVENT = 'mushi:pagehelp-prefs-change'

export function readPageHelpAlwaysOpen(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(ALWAYS_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

export function writePageHelpAlwaysOpen(next: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (next) {
      window.localStorage.setItem(ALWAYS_OPEN_KEY, '1')
    } else {
      window.localStorage.removeItem(ALWAYS_OPEN_KEY)
    }
    window.dispatchEvent(new CustomEvent(PAGEHELP_PREFS_EVENT, { detail: next }))
  } catch {
    /* private mode */
  }
}
