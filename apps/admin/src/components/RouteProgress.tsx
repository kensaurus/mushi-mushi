/**
 * FILE: apps/admin/src/components/RouteProgress.tsx
 * PURPOSE: Top-edge route-transition progress bar keyed off `useLocation()` pathname
 *          changes (legacy BrowserRouter; motion-reduce gated, skips first mount).
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
