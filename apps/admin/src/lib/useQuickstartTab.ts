/**
 * FILE: apps/admin/src/lib/useQuickstartTab.ts
 * PURPOSE: Quick mode chooses the tab a page opens on, once, and then lets go.
 *
 * Pages used to run `if (activeTab !== quickTab) setActiveTab(quickTab)` on
 * every render while quick mode was on. Every in-page button, banner CTA and
 * `?tab=` deep link was reverted on the next render, so Billing Support, the
 * Notifications Outbox, Health Activity, Releases Draft and more could not be
 * reached in the default mode. Guarding on `?tab` being empty is not enough:
 * each page deletes `tab` for its default tab, so clicking that tab re-pinned.
 *
 * Rules:
 *   - A `?tab=` present when the page mounts is a deep link; it always wins.
 *   - Otherwise, once the page's stats are ready, open the posture tab once.
 *   - If anything moves the tab before that (a click, a link), stop choosing.
 */

import { useEffect, useRef } from 'react'

export interface QuickstartTabOptions<T extends string> {
  /** True while the mode that picks a landing tab is on (usually quick mode). */
  enabled: boolean
  /** True once the stats the posture is derived from have loaded. */
  ready: boolean
  /** The page's `?tab=` value at this render (null when absent). */
  tabParam: string | null
  /** The tab the page currently shows. */
  activeTab: T
  /** The tab the posture asks for. Read only once `ready` is true. */
  quickTab: T
  setActiveTab: (tab: T) => void
}

export function useQuickstartLandingTab<T extends string>({
  enabled,
  ready,
  tabParam,
  activeTab,
  quickTab,
  setActiveTab,
}: QuickstartTabOptions<T>): void {
  // Decided at mount: a deep link means the choice is already made.
  const doneRef = useRef(tabParam !== null)
  const mountTabRef = useRef(activeTab)

  useEffect(() => {
    if (doneRef.current) return
    if (activeTab !== mountTabRef.current) {
      // The user or a link moved the tab before the posture was known.
      doneRef.current = true
      return
    }
    if (!enabled || !ready) return
    doneRef.current = true
    if (quickTab !== activeTab) setActiveTab(quickTab)
  }, [enabled, ready, activeTab, quickTab, setActiveTab])
}
