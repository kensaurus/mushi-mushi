/**
 * FILE: apps/admin/src/lib/debug.ts
 * PURPOSE: Console-level diagnostic logging for the admin console.
 *          Gated by localStorage key 'mushi:debug' or ?debug=true URL param.
 *          When enabled, logs all apiFetch calls with URL, status, timing,
 *          auth state changes, and response summaries.
 *          Colour styles are built when a line is logged. This module loads
 *          before index.css, so a module-scope readVizToken() would freeze
 *          the stand-in grey for the rest of the page.
 */

import { readVizToken } from './vizTokens'

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

const PREFIX = '%c[mushi:debug]'
const RESET_STYLE = 'color: inherit;'

function prefixStyle(): string {
  return `color: ${readVizToken('accent')}; font-weight: bold;`
}

// `category` and `message` are passed as `%s` data arguments (never
// interpolated into the format string) so a value containing `%` console
// directives can't hijack formatting — see CodeQL js/tainted-format-string.
const FORMAT = `${PREFIX} %c%s%c %s`

export function debugLog(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  const catStyle = `color: ${readVizToken('accent-foreground')}; font-weight: 600;`
  const style = prefixStyle()
  if (data) {
    console.log(FORMAT, style, catStyle, category, RESET_STYLE, message, data)
  } else {
    console.log(FORMAT, style, catStyle, category, RESET_STYLE, message)
  }
}

export function debugWarn(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  console.warn(FORMAT, prefixStyle(), `color: ${readVizToken('viz-score-warn')}; font-weight: 600;`, category, RESET_STYLE, message, data ?? '')
}

export function debugError(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  console.error(FORMAT, prefixStyle(), `color: ${readVizToken('viz-flow-danger')}; font-weight: 600;`, category, RESET_STYLE, message, data ?? '')
}
