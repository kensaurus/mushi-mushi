/**
 * FILE: apps/admin/src/lib/mode.ts
 * PURPOSE: Beginner / Advanced admin mode primitive (Wave L).
 *
 *  Beginner mode is the default for first-time visitors. It:
 *    1. Filters the sidebar to 9 loop-essential pages (Layout.tsx reads `beginner: true`)
 *    2. Surfaces a persistent <NextBestAction> strip on every page
 *    3. Pulls plain-language copy from `lib/copy.ts` (vs the jargon-rich
 *       advanced copy preserved for power users)
 *    4. Forces full-detail microcopy: KPI tooltips visible, axis labels on
 *       charts, GraphStoryboard as the default Knowledge-Graph view, etc.
 *
 *  Persisted in `localStorage:'mushi:mode'`. The choice survives reloads,
 *  follows the user across projects, and is exposed as a single hook so
 *  consumers don't reach into localStorage themselves.
 */

import { useCallback, useEffect, useState } from 'react'

export type AdminMode = 'beginner' | 'advanced'

const STORAGE_KEY = 'mushi:mode'
const DEFAULT_MODE: AdminMode = 'beginner'

function readMode(): AdminMode {
  if (typeof window === 'undefined') return DEFAULT_MODE
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === 'advanced' ? 'advanced' : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

function writeMode(mode: AdminMode) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
    // Notify in-tab listeners; the native `storage` event only fires
    // cross-tab, so without this dispatch the toggle in the sidebar would
    // not re-render the same tab's NavLinks/NextBestAction strip.
    window.dispatchEvent(new CustomEvent('mushi:mode-change', { detail: mode }))
  } catch {
    /* localStorage write may fail in private mode — non-fatal */
  }
}

export interface UseAdminModeResult {
  mode: AdminMode
  setMode: (mode: AdminMode) => void
  toggle: () => void
  isBeginner: boolean
  isAdvanced: boolean
}

export function useAdminMode(): UseAdminModeResult {
  const [mode, setModeState] = useState<AdminMode>(() => readMode())

  useEffect(() => {
    function onChange(e: Event) {
      const detail = (e as CustomEvent<AdminMode>).detail
      if (detail === 'beginner' || detail === 'advanced') {
        setModeState(detail)
      } else {
        setModeState(readMode())
      }
    }
    window.addEventListener('mushi:mode-change', onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('mushi:mode-change', onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const setMode = useCallback((next: AdminMode) => {
    writeMode(next)
    setModeState(next)
  }, [])

  const toggle = useCallback(() => {
    setMode(mode === 'beginner' ? 'advanced' : 'beginner')
  }, [mode, setMode])

  return {
    mode,
    setMode,
    toggle,
    isBeginner: mode === 'beginner',
    isAdvanced: mode === 'advanced',
  }
}
