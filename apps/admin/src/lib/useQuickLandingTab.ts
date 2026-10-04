/**
 * FILE: apps/admin/src/lib/useQuickLandingTab.ts
 * PURPOSE: Quickstart mode opens a page on the tab that matches its current
 *          posture, once, and only when the URL did not ask for a tab.
 *
 * The /health and /marketplace pages used to re-pin the tab whenever it
 * differed from the posture tab. With the tab bar hidden that made every
 * other tab unreachable: "Filter activity" bounced back, `?tab=` deep links
 * were overridden, and after one healthy plugin install Browse could not be
 * opened again. Realtime reloads change the stats, so the landing is
 * remembered per mount rather than re-derived.
 */
import { useEffect, useRef } from 'react'

export interface QuickLandingOptions<T extends string> {
  /** Quickstart mode is on. */
  enabled: boolean
  /** The stats the posture is derived from have loaded. */
  ready: boolean
  /** The URL carries an explicit `?tab=` (or another param that picks one). */
  hasExplicitTab: boolean
  /** The tab on screen now. */
  activeTab: T
  /** The posture tab for the current stats. */
  resolve: () => T
  /** Switch tabs (replacing history, not pushing). */
  apply: (tab: T) => void
}

export function useQuickLandingTab<T extends string>({
  enabled,
  ready,
  hasExplicitTab,
  activeTab,
  resolve,
  apply,
}: QuickLandingOptions<T>): void {
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current || !enabled || !ready) return
    landed.current = true
    if (hasExplicitTab) return
    const target = resolve()
    if (target !== activeTab) apply(target)
  }, [enabled, ready, hasExplicitTab, activeTab, resolve, apply])
}
