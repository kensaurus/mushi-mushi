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

const PREFIX = '%c[mushi:debug]'
const STYLE = 'color: #7c3aed; font-weight: bold;'

export function debugLog(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  if (data) {
    console.log(`${PREFIX} %c${category}%c ${message}`, STYLE, 'color: #a78bfa; font-weight: 600;', 'color: inherit;', data)
  } else {
    console.log(`${PREFIX} %c${category}%c ${message}`, STYLE, 'color: #a78bfa; font-weight: 600;', 'color: inherit;')
  }
}

export function debugWarn(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  console.warn(`${PREFIX} %c${category}%c ${message}`, STYLE, 'color: #f59e0b; font-weight: 600;', 'color: inherit;', data ?? '')
}

export function debugError(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return
  console.error(`${PREFIX} %c${category}%c ${message}`, STYLE, 'color: #ef4444; font-weight: 600;', 'color: inherit;', data ?? '')
}
