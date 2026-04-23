/**
 * FILE: apps/admin/src/lib/useDensity.ts
 * PURPOSE: Global UI density preference (compact / default / comfortable)
 *          persisted in localStorage and applied via a `data-density`
 *          attribute on <html>. Pages and components that care (tables,
 *          cards) read the preference from CSS selectors — no prop
 *          drilling through the component tree.
 *
 *          This lets power users who triage hundreds of reports a day
 *          pick compact and fit 2× more rows on screen, while someone
 *          scanning a dashboard can pick comfortable and get generous
 *          touch targets on iPad/tablet.
 */

import { useCallback, useEffect, useState } from 'react'

export type Density = 'compact' | 'default' | 'comfortable'

const STORAGE_KEY = 'mushi:density:v1'

function readInitial(): Density {
  if (typeof window === 'undefined') return 'default'
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'compact' || raw === 'comfortable' || raw === 'default') return raw
  } catch {
    // ignore
  }
  return 'default'
}

function applyToDom(density: Density) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-density', density)
}

export function useDensity(): { density: Density; setDensity: (d: Density) => void } {
  const [density, setDensityState] = useState<Density>(readInitial)

  useEffect(() => {
    applyToDom(density)
  }, [density])

  // Cross-tab sync so flipping density in one tab lands in all the
  // others — same pattern we use for saved views.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      const v = e.newValue as Density | null
      if (v === 'compact' || v === 'comfortable' || v === 'default') setDensityState(v)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setDensity = useCallback((d: Density) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, d)
    } catch {
      // ignore
    }
    setDensityState(d)
  }, [])

  return { density, setDensity }
}

/** Apply the saved density to <html> as early as possible — called from
 *  main.tsx so the first paint already reflects the preference and avoids
 *  the "jump" users would otherwise see if we waited for React mount. */
export function hydrateDensity(): void {
  applyToDom(readInitial())
}
