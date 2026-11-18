/**
 * FILE: apps/admin/src/lib/useEdgeFade.ts
 * PURPOSE: A right-edge fade on a horizontal strip while more of it sits past the edge
 *          (fresh-eyes 2026-11-18: tab strips were cut off on a phone, "Digest", "Weekly insi…",
 *          with no hint that they scroll). The fade goes once the end is in view.
 *
 *   const fade = useEdgeFade<HTMLUListElement>(tabs.length)
 *   <ul ref={fade.ref} className={`overflow-x-auto ${fade.className}`}>…</ul>
 */

import { useEffect, useRef, useState } from 'react'

export const EDGE_FADE_CLASS = '[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]'

export function useEdgeFade<T extends HTMLElement>(dep: unknown = null): { ref: React.RefObject<T | null>; more: boolean; className: string } {
  const ref = useRef<T | null>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
    }
  }, [dep])
  return { ref, more, className: more ? EDGE_FADE_CLASS : '' }
}
