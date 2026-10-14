/**
 * FILE: apps/admin/src/lib/mode.ts
 * PURPOSE: Quickstart / Beginner / Advanced admin mode primitive.
 *
 * Quickstart mode is the default for first-time visitors. It:
 *    1. Shows about 10 sidebar pages, grouped by the steps of the cycle
 *       (SIMPLE_NAV_GROUPS in navRegistry.ts: Connect, Bugs, Fix, Ship &
 *       watch, Account); before the first bug only the setup pages show
 *    2. Hides PDCA terminology entirely; uses verb-led labels
 *    3. Pulls quickstart copy from `lib/copy.ts` (verb-first, jargon-free)
 *
 *  Beginner mode is the secondary onboarding tier. It:
 *    1. Adds a few next steps to the same groups (and a Verify group)
 *    2. Surfaces a persistent <NextStep> banner on every page
 *    3. Pulls plain-language copy from `lib/copy.ts`
 *    4. Forces full-detail microcopy: KPI tooltips, axis labels, etc.
 *
 *  Advanced mode is the power-user surface — every page, under the six
 *  numbered cycle sections of NAV_SECTION_META (ADR 0027).
 *
 *  Persisted in `localStorage:'mushi:mode'`. The choice survives reloads,
 *  follows the user across projects, and is exposed as a single hook so
 *  consumers don't reach into localStorage themselves.
 */

import { useCallback, useEffect, useState } from 'react'

export type AdminMode = 'quickstart' | 'beginner' | 'advanced'

const STORAGE_KEY = 'mushi:mode'
const DEFAULT_MODE: AdminMode = 'quickstart'
const MODE_ORDER: AdminMode[] = ['quickstart', 'beginner', 'advanced']

function readMode(): AdminMode {
  if (typeof window === 'undefined') return DEFAULT_MODE
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'quickstart' || v === 'beginner' || v === 'advanced') return v
    return DEFAULT_MODE
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
    // not re-render the same tab's NavLinks/NextStep banner.
    window.dispatchEvent(new CustomEvent('mushi:mode-change', { detail: mode }))
  } catch {
    /* localStorage write may fail in private mode — non-fatal */
  }
}

export interface UseAdminModeResult {
  mode: AdminMode
  setMode: (mode: AdminMode) => void
  /** Cycles quickstart → beginner → advanced → quickstart. Kept for
   *  backwards-compat with older one-button toggles. The 3-state pill in
   *  the sidebar calls `setMode` directly instead. */
  toggle: () => void
  isQuickstart: boolean
  isBeginner: boolean
  isAdvanced: boolean
}

export function useAdminMode(): UseAdminModeResult {
  const [mode, setModeState] = useState<AdminMode>(() => readMode())

  useEffect(() => {
    function onChange(e: Event) {
      const detail = (e as CustomEvent<AdminMode>).detail
      if (detail === 'quickstart' || detail === 'beginner' || detail === 'advanced') {
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
    const i = MODE_ORDER.indexOf(mode)
    const next = MODE_ORDER[(i + 1) % MODE_ORDER.length]
    setMode(next)
  }, [mode, setMode])

  return {
    mode,
    setMode,
    toggle,
    isQuickstart: mode === 'quickstart',
    isBeginner: mode === 'beginner',
    isAdvanced: mode === 'advanced',
  }
}
