/**
 * FILE: apps/admin/src/lib/debug.ts
 * PURPOSE: Console-level diagnostic logging for the admin console.
 *          Gated by localStorage key 'mushi:debug' or ?debug=true URL param.
 *          When enabled, logs all apiFetch calls with URL, status, timing,
 *          auth state changes, and response summaries.
 */

const STORAGE_KEY = 'mushi:debug'

export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).get('debug') === 'true') {
    localStorage.setItem(STORAGE_KEY, 'true')
    return true
  }
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

export function setDebugEnabled(enabled: boolean): void {
  if (enabled) localStorage.setItem(STORAGE_KEY, 'true')
  else localStorage.removeItem(STORAGE_KEY)
}

import { readVizToken } from './vizTokens'

const PREFIX = '%c[mushi:debug]'
const STYLE = `color: ${readVizToken('accent')}; font-weight: bold;`
const RESET_STYLE = 'color: inherit;'

// `category` and `message` are passed as `%s` data arguments (never
// interpolated into the format string) so a value containing `%` console
// directives can't hijack formatting — see CodeQL js/tainted-format-string.
const FORMAT = `${PREFIX} %c%s%c %s`

export function debugLog(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  const catStyle = `color: ${readVizToken('accent-foreground')}; font-weight: 600;`
  if (data) {
    console.log(FORMAT, STYLE, catStyle, category, RESET_STYLE, message, data)
  } else {
    console.log(FORMAT, STYLE, catStyle, category, RESET_STYLE, message)
  }
}

export function debugWarn(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  console.warn(FORMAT, STYLE, `color: ${readVizToken('viz-score-warn')}; font-weight: 600;`, category, RESET_STYLE, message, data ?? '')
}

export function debugError(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  console.error(FORMAT, STYLE, `color: ${readVizToken('viz-flow-danger')}; font-weight: 600;`, category, RESET_STYLE, message, data ?? '')
}
