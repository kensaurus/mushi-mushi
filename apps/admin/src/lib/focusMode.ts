/**
 * FILE: apps/admin/src/lib/focusMode.ts
 * PURPOSE: Persisted console focus mode. Hides chrome so dense worklists and
 *          canvases can breathe without losing route state.
 *
 * Consent routes (`/cli-auth`, `/mcp-auth`) always use focus chrome so the
 * Approve/Deny task is not buried under sidebar + status strips. That override
 * does not rewrite the user's persisted preference.
 */

import { useCallback, useSyncExternalStore } from 'react'

const KEY = 'mushi:focusMode:v1'

/** One-shot auth/consent pages — always render with focus chrome. */
const CONSENT_FOCUS_PATHS = ['/cli-auth', '/mcp-auth'] as const

export function isConsentFocusPath(pathname: string): boolean {
  return CONSENT_FOCUS_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function readFocusMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

// One value for every caller in the tab (the shell and Settings › Display),
// so a toggle in one place is the state everywhere.
let current: boolean | null = null
const listeners = new Set<() => void>()

function snapshot(): boolean {
  if (current === null) current = readFocusMode()
  return current
}

function apply(next: boolean): void {
  current = next
  if (typeof document !== 'undefined') document.documentElement.dataset.focusMode = next ? 'true' : 'false'
  try {
    window.localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    /* private mode: this tab keeps it */
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (typeof document !== 'undefined') document.documentElement.dataset.focusMode = snapshot() ? 'true' : 'false'
  return () => listeners.delete(listener)
}

export function useFocusMode(): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const enabled = useSyncExternalStore(subscribe, snapshot, () => false)
  const setEnabled = useCallback((next: boolean | ((value: boolean) => boolean)) => {
    apply(typeof next === 'function' ? next(snapshot()) : next)
  }, [])
  return [enabled, setEnabled]
}
