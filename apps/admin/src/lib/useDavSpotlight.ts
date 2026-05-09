/**
 * FILE: apps/admin/src/lib/useDavSpotlight.ts
 * PURPOSE: Scroll-and-highlight helper for the Decide → Act → Verify hero.
 *          When an operator clicks a tile, this hook scrolls the relevant
 *          on-page element into view and briefly applies a branded outline
 *          pulse so the eye lands exactly where the tile was pointing.
 *
 *          Usage:
 *            const { spotlight } = useDavSpotlight()
 *            spotlight('health:decide')  // looks for [data-dav-anchor="health:decide"]
 *
 *          The effect:
 *            1. document.querySelector('[data-dav-anchor="<value>"]')
 *            2. scrollIntoView({ behavior: 'smooth', block: 'center' })
 *            3. Sets data-dav-spotlight="active" on the element → CSS drives
 *               the animated outline (@keyframes mushi-spotlight in index.css)
 *            4. Removes the attribute after 1800ms
 *
 *          Falls back gracefully: if the element is not in the DOM (collapsed
 *          section, loading state, narrow-viewport layout variant), the hook
 *          returns a `fallback` boolean so the caller can show a fallback hint
 *          (e.g. "scroll to the [Section] panel").
 *
 *          Motion safety: the CSS animation respects prefers-reduced-motion —
 *          the attribute is still applied (for the outline), just without the
 *          pulse keyframe, so the border is visible without moving.
 */

import { useCallback, useEffect, useRef } from 'react'

const SPOTLIGHT_DURATION_MS = 1800
const ATTR = 'data-dav-spotlight'
const ANCHOR_ATTR = 'data-dav-anchor'

export interface UseDavSpotlightReturn {
  /**
   * Scroll to the element carrying `data-dav-anchor="<anchorValue>"` and
   * briefly outline it. Returns `true` if the element was found and the
   * scroll was triggered; `false` if no element matched.
   */
  spotlight: (anchorValue: string) => boolean
  /** Remove any active spotlight immediately (e.g. on tile collapse). */
  clearSpotlight: () => void
}

export function useDavSpotlight(): UseDavSpotlightReturn {
  // Keep a ref to the currently-spotlit element so clearSpotlight can
  // clean up without holding a stale closure over the element.
  const activeRef = useRef<Element | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSpotlight = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (activeRef.current) {
      activeRef.current.removeAttribute(ATTR)
      activeRef.current = null
    }
  }, [])

  const spotlight = useCallback(
    (anchorValue: string): boolean => {
      const selector = `[${ANCHOR_ATTR}="${anchorValue}"]`
      const el = document.querySelector(selector)
      if (!el) return false

      // Clear any previous spotlight before starting a new one.
      clearSpotlight()

      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.setAttribute(ATTR, 'active')
      activeRef.current = el

      timerRef.current = setTimeout(() => {
        el.removeAttribute(ATTR)
        if (activeRef.current === el) activeRef.current = null
        timerRef.current = null
      }, SPOTLIGHT_DURATION_MS)

      return true
    },
    [clearSpotlight],
  )

  // Cancel any pending spotlight timer when the consuming component
  // unmounts (e.g. route change). Without this, a setTimeout fires
  // ~1800ms after navigation and leaks a callback referencing a
  // possibly-detached DOM node.
  useEffect(() => clearSpotlight, [clearSpotlight])

  return { spotlight, clearSpotlight }
}
