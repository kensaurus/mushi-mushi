/**
 * FILE: apps/admin/src/lib/sidebarCollapsed.ts
 * PURPOSE: Persisted desktop-sidebar collapse state. Collapsing the sidebar
 *          drops it from a 240px nav rail to a 48px icon rail so dense
 *          worklists (Reports table, Graph, Fixes board) get back the
 *          horizontal real estate without paying the focus-mode tax of
 *          hiding the sub-header + PDCA ribbon entirely.
 *
 *          Stored through usePersistentState (`mushi:ui:sidebar-collapsed`,
 *          console-wide, fail-safe when storage is blocked). The first read
 *          after this change seeds from the older `mushi:sidebarCollapsed:v1`
 *          key so nobody's choice resets.
 *
 *          A useEffect writes the flag to <html data-sidebar="…"> so CSS and
 *          other components can react. Returns `[value, setter]` like
 *          useFocusMode so callers can swap between the two.
 *
 *          Mobile is unaffected: the mobile sidebar is a full overlay
 *          opened from a hamburger, so "collapsed" doesn't make sense
 *          below the `md:` breakpoint.
 */

import { useEffect } from 'react'
import { usePersistentState } from './usePersistentState'

const LEGACY_KEY = 'mushi:sidebarCollapsed:v1'

/** The pre-usePersistentState value, or collapsed (the default) when absent. */
function legacySidebarCollapsed(): boolean {
  try {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(LEGACY_KEY)
    if (stored === '0') return false
    return true
  } catch {
    return true
  }
}

export function useSidebarCollapsed(): [
  boolean,
  (next: boolean | ((current: boolean) => boolean)) => void,
] {
  const [collapsed, setCollapsed] = usePersistentState('sidebar-collapsed', legacySidebarCollapsed(), {
    validate: (v): v is boolean => typeof v === 'boolean',
  })

  useEffect(() => {
    document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'expanded'
  }, [collapsed])

  return [collapsed, setCollapsed]
}
