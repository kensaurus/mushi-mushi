/**
 * FILE: apps/admin/src/lib/sidebarCollapsed.ts
 * PURPOSE: Persisted desktop-sidebar collapse state. Collapsing the sidebar
 *          drops it from a 240px nav rail to a 48px icon rail so dense
 *          worklists (Reports table, Graph, Fixes board) get back the
 *          horizontal real estate without paying the focus-mode tax of
 *          hiding the sub-header + PDCA ribbon entirely.
 *
 *          Mirrors the focusMode hook contract:
 *            - localStorage-backed (`mushi:sidebarCollapsed:v1`)
 *            - useEffect writes the flag back to <html data-sidebar="…">
 *              so CSS / other components can react if needed
 *            - returns the same `[value, setter]` shape so callers can
 *              swap between this and useFocusMode without rewiring
 *
 *          Mobile is unaffected: the mobile sidebar is a full overlay
 *          opened from a hamburger, so "collapsed" doesn't make sense
 *          below the `md:` breakpoint. The desktop layout reads this
 *          flag only when rendering the `hidden md:flex` aside.
 *
 *          Pattern reference: Linear's collapsible sidebar
 *          (https://linear.app/changelog/unpublished-collapsible-sidebar) —
 *          icon-only collapsed state with hover tooltips, `[` hotkey,
 *          and persistent state across reloads.
 */

import { useEffect, useState } from 'react'

const KEY = 'mushi:sidebarCollapsed:v1'

function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return true
  const stored = window.localStorage.getItem(KEY)
  if (stored === '1') return true
  if (stored === '0') return false
  return true
}

export function useSidebarCollapsed(): [
  boolean,
  (next: boolean | ((current: boolean) => boolean)) => void,
] {
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed)

  useEffect(() => {
    document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'expanded'
    window.localStorage.setItem(KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return [collapsed, setCollapsed]
}
