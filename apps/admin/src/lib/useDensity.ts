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
 *
 * 2026-05-07: density now drives THREE CSS variables on <html>:
 *
 *            --ui-scale        body font-size multiplier (0.86 / 1 / 1.14)
 *            --ui-line-scale   line-height multiplier   (0.92 / 1 / 1.08)
 *            --ui-pad          spacing multiplier       (0.65 / 1 / 1.35)
 *
 *          The earlier revision moved only --ui-scale, which users
 *          (rightly) reported as "I clicked compact and nothing
 *          happened". --ui-pad is wired into the most-visible spacings
 *          (nav links, section headers, page-stack margins, command
 *          palette items) so flipping density gives an instantly
 *          readable shell-wide rhythm change. Card / dialog interiors
 *          intentionally don't read --ui-pad — that would warp grid
 *          math; the goal is "more rows visible", not "everything
 *          half-size".
 */

import { useCallback, useEffect, useState } from 'react'

export type Density = 'compact' | 'default' | 'comfortable'

const STORAGE_KEY = 'mushi:density:v1'

function readInitial(): Density {
  // 2026-05-07 product call: default is now `compact`. Mushi's primary
  // user is a triage operator, not a casual scanner — they want maximum
  // rows on screen out of the box. Cloudscape's general advice is "always
  // default to comfortable", which is correct for consumer SaaS but not
  // for an ops console. Users who prefer roomier rhythm flip to standard
  // or comfortable from the sidebar (and the choice persists per-tab via
  // localStorage + cross-tab via the storage event below).
  if (typeof window === 'undefined') return 'compact'
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'compact' || raw === 'comfortable' || raw === 'default') return raw
  } catch {
    // ignore
  }
  return 'compact'
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
