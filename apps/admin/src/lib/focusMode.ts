/**
 * FILE: apps/admin/src/lib/focusMode.ts
 * PURPOSE: Persisted console focus mode. Hides chrome so dense worklists and
 *          canvases can breathe without losing route state.
 */

import { useEffect, useState } from 'react'

const KEY = 'mushi:focusMode:v1'

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
