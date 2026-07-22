/**
 * FILE: apps/admin/src/lib/focusMode.ts
 * PURPOSE: Persisted console focus mode. Hides chrome so dense worklists and
 *          canvases can breathe without losing route state.
 *
 * Consent routes (`/cli-auth`, `/mcp-auth`) always use focus chrome so the
 * Approve/Deny task is not buried under sidebar + status strips. That override
 * does not rewrite the user's persisted preference.
 */

import { useEffect, useState } from 'react'

const KEY = 'mushi:focusMode:v1'

/** One-shot auth/consent pages — always render with focus chrome. */
export const CONSENT_FOCUS_PATHS = ['/cli-auth', '/mcp-auth'] as const

export function isConsentFocusPath(pathname: string): boolean {
  return CONSENT_FOCUS_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function readFocusMode(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(KEY) === '1'
}

export function useFocusMode(): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const [enabled, setEnabled] = useState(readFocusMode)

  useEffect(() => {
    document.documentElement.dataset.focusMode = enabled ? 'true' : 'false'
    window.localStorage.setItem(KEY, enabled ? '1' : '0')
  }, [enabled])

  return [enabled, setEnabled]
}
