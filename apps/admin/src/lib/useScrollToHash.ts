/**
 * FILE: apps/admin/src/lib/useScrollToHash.ts
 * PURPOSE: Scroll to the element a `#hash` names once the page has rendered.
 *
 * react-router does not scroll to a hash, so a banner CTA such as
 * `/integrations/config?project=…#platform-card-sentry` used to "reload" the
 * page the user was already on and leave them where they were. Keyed on the
 * location key, so clicking the same link twice scrolls twice.
 *
 * Cards above the target can finish loading after the scroll and push it
 * down: /settings?tab=ci-cost landed about 2,750 px past CI cost (2026-10-28).
 * So for a few seconds the page follows the target each time it grows, and
 * stops as soon as the person scrolls, taps or presses a key.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const FOLLOW_MS = 4000

export function useScrollToHash(ready: boolean): void {
  const location = useLocation()
  useEffect(() => {
    if (!ready || !location.hash) return
    let id: string
    try {
      id = decodeURIComponent(location.hash.slice(1))
    } catch {
      return
    }
    if (!id) return
    const el = document.getElementById(id)
    if (!el) return
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })

    if (typeof ResizeObserver !== 'function') return
    let following = true
    const observer = new ResizeObserver(() => {
      if (following && el.isConnected) el.scrollIntoView({ behavior: 'auto', block: 'start' })
    })
    const stop = () => {
      following = false
      observer.disconnect()
    }
    const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const
    for (const name of events) window.addEventListener(name, stop, { passive: true })
    observer.observe(document.body)
    const timer = window.setTimeout(stop, FOLLOW_MS)
    return () => {
      window.clearTimeout(timer)
      stop()
      for (const name of events) window.removeEventListener(name, stop)
    }
  }, [ready, location.hash, location.key])
}
