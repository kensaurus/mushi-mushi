/**
 * FILE: apps/admin/src/lib/useMediaQuery.ts
 * PURPOSE: Subscribe to a CSS media query (useSyncExternalStore). Guards
 *          environments without `matchMedia` (jsdom, old embeds) by returning
 *          the fallback instead of throwing.
 */

import { useCallback, useSyncExternalStore } from 'react'

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  const getSnapshot = () => (hasMatchMedia() ? window.matchMedia(query).matches : fallback)
  return useSyncExternalStore(subscribe, getSnapshot, () => fallback)
}
