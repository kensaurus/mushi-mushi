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
 *
 * The console scrolls inside <main>, not the window, so <body> never grows
 * when a card above loads: /ci#ci-placement stayed 5,867 px off (2026-10-30).
 * It watches the target's scroll container's children as well.
 *
 * A section that loads its own data renders nothing until then, so on an
 * in-console link (data already cached, page ready at once) the target did
 * not exist yet and the hook gave up: Fix on "Monthly AI budget" opened
 * /settings#spend-limits at the top of the page (2026-10-30). It now waits
 * for the target to appear, for the same few seconds.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const FOLLOW_MS = 8000
const MAX_OBSERVED = 60

/** The nearest ancestor that scrolls (overflow-y auto or scroll), else null. */
function scrollContainer(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if (y === 'auto' || y === 'scroll') return p
  }
  return null
}

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
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let following = true
    let resize: ResizeObserver | null = null
    let appear: MutationObserver | null = null
    const stop = () => {
      following = false
      resize?.disconnect()
      appear?.disconnect()
    }
    const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const

    const follow = (el: HTMLElement) => {
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
      if (typeof ResizeObserver !== 'function') return
      resize = new ResizeObserver(() => {
        if (following && el.isConnected) el.scrollIntoView({ behavior: 'auto', block: 'start' })
      })
      resize.observe(document.body)
      // What actually grows: the scroll container's content.
      const box = scrollContainer(el)
      if (box) for (const child of Array.from(box.children).slice(0, MAX_OBSERVED)) resize.observe(child)
    }

    const el = document.getElementById(id)
    if (el) follow(el)
    else if (typeof MutationObserver === 'function') {
      appear = new MutationObserver(() => {
        const found = following ? document.getElementById(id) : null
        if (!found) return
        appear?.disconnect()
        appear = null
        follow(found)
      })
      appear.observe(document.body, { childList: true, subtree: true })
    } else return

    for (const name of events) window.addEventListener(name, stop, { passive: true })
    const timer = window.setTimeout(stop, FOLLOW_MS)
    return () => {
      window.clearTimeout(timer)
      stop()
      for (const name of events) window.removeEventListener(name, stop)
    }
  }, [ready, location.hash, location.key])
}
