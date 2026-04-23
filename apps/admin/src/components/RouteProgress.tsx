/**
 * FILE: apps/admin/src/components/RouteProgress.tsx
 * PURPOSE: GitHub/Linear-style top-edge progress bar that fills on every
 *          route transition. Mounted once in Layout so every navigation
 *          gets a 2 px brand-toned indicator without the page having to
 *          opt in.
 *
 *          Implementation note: the admin uses the legacy
 *          `<BrowserRouter>` (not a data router created via
 *          `createBrowserRouter`), so `useNavigation()` is unavailable
 *          and throws "useNavigation must be used within a data
 *          router." We instead key off `useLocation().pathname`
 *          transitions — whenever the path changes, we animate the bar
 *          from 0 → 70 → 100 % over ~650 ms regardless of actual load
 *          state. The result is visually indistinguishable for the user
 *          because the admin's lazy routes resolve in well under 200 ms
 *          in dev and the cached-chunk case still benefits from the
 *          motion confirming "yes, we moved".
 *
 *          - Gated by `motion-reduce:hidden` so reduced-motion users
 *            see no bar (NN/g / WCAG 2.3.3).
 *          - Skips the very first mount — the initial paint isn't a
 *            "navigation" in the UX sense, it's just the app loading.
 *
 *          Wave T.1.3 (2026-04-23): introduced as part of the trust /
 *          context wave alongside `<FreshnessPill>` and
 *          `<ActiveFiltersRail>`.
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

const FILL_TARGET_INITIAL = 0.7
const FILL_DURATION_MS = 400
const COMPLETE_HOLD_MS = 200

export function RouteProgress() {
  const location = useLocation()
  const [progress, setProgress] = useState<number>(0)
  const [visible, setVisible] = useState<boolean>(false)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const isFirstMountRef = useRef<boolean>(true)
  const prevPathRef = useRef<string>(location.pathname)

  useEffect(() => {
    // Don't animate on initial mount — that's page load, not a navigation.
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false
      prevPathRef.current = location.pathname
      return
    }
    if (prevPathRef.current === location.pathname) return
    prevPathRef.current = location.pathname

    // Cancel any in-flight animation from a prior transition.
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    if (completeTimerRef.current) clearTimeout(completeTimerRef.current)
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    fadeTimerRef.current = null
    completeTimerRef.current = null
    rafRef.current = null

    setVisible(true)
    setProgress(0.05)

    // Phase 1: ease 0.05 → 0.7 over FILL_DURATION_MS.
    const start = performance.now()
    const tick = (now: number) => {
      const elapsed = now - start
      const t = Math.min(elapsed / FILL_DURATION_MS, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setProgress(0.05 + eased * (FILL_TARGET_INITIAL - 0.05))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        // Phase 2: snap to 100 %, hold, then fade.
        setProgress(1)
        completeTimerRef.current = setTimeout(() => {
          setVisible(false)
          setProgress(0)
          completeTimerRef.current = null
        }, COMPLETE_HOLD_MS)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [location.pathname])

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  if (!visible) return null

  return (
    <div
      role="progressbar"
      aria-label="Loading next page"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className="pointer-events-none fixed left-0 right-0 top-0 z-[60] h-0.5 motion-reduce:hidden"
    >
      <div
        className="h-full bg-brand shadow-[0_0_8px_var(--color-brand)] motion-safe:transition-[width,opacity] motion-safe:duration-150 motion-safe:ease-out"
        style={{
          width: `${(progress * 100).toFixed(1)}%`,
          opacity: progress >= 1 ? 0 : 1,
        }}
      />
    </div>
  )
}
