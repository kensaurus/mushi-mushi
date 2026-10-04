/**
 * FILE: apps/admin/src/lib/useScrollToHash.ts
 * PURPOSE: Scroll to the element a `#hash` names once the page has rendered.
 *
 * react-router does not scroll to a hash, so a banner CTA such as
 * `/integrations/config?project=…#platform-card-sentry` used to "reload" the
 * page the user was already on and leave them where they were. Keyed on the
 * location key, so clicking the same link twice scrolls twice.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

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
  }, [ready, location.hash, location.key])
}
