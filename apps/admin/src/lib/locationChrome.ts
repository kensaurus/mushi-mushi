/**
 * Shared location chrome contract — avoids duplicating route / project / PDCA
 * stage between ChromeBreadcrumb (md+ top bar) and PageHeaderBar.
 */

import { useSyncExternalStore } from 'react'

/** Desktop sub-header shows breadcrumb at md+; mobile uses drawer title only. */
export function useBreadcrumbVisible(): boolean {
  return useSyncExternalStore(
    subscribeViewport,
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
    () => true,
  )
}

const viewportListeners = new Set<() => void>()
let viewportMql: MediaQueryList | null = null

function subscribeViewport(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  viewportListeners.add(onStoreChange)
  if (!viewportMql) {
    viewportMql = window.matchMedia('(min-width: 768px)')
    viewportMql.addEventListener('change', emitViewport)
  }
  return () => {
    viewportListeners.delete(onStoreChange)
  }
}

function emitViewport() {
  viewportListeners.forEach((l) => l())
}

export interface LocationChromeFlags {
  /** Breadcrumb shows project name — suppress mid-title projectScope. */
  suppressProjectScope: boolean
  /** Breadcrumb shows route — PDCA chip lives in PageHeaderBar only on mobile. */
  suppressContextChip: boolean
}

export function useLocationChrome(): LocationChromeFlags {
  const breadcrumbVisible = useBreadcrumbVisible()
  return {
    suppressProjectScope: breadcrumbVisible,
    suppressContextChip: breadcrumbVisible,
  }
}
