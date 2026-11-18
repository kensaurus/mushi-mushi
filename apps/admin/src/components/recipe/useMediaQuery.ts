/**
 * FILE: apps/admin/src/components/recipe/useMediaQuery.ts
 * PURPOSE: When the Recipe page shows its ordered list instead of the canvas.
 */

import { useLayoutEffect, useState, type RefObject } from 'react'
import { useMediaQuery } from '../../lib/useMediaQuery'

/**
 * The column width the diagram needs at 100% (four lanes plus the 16 px edge pad), so Auto shows
 * the list instead of cutting "What is live" and the Runtime lane off at the right (2026-11-18).
 * Kept here, not read from recipeFlow.data.ts, so the list path never loads @xyflow/react;
 * recipeFlow.data.test.ts pins it to recipeDiagramBounds().
 */
export const RECIPE_DIAGRAM_MIN_WIDTH = 1168

/** True when the element is wide enough for the whole diagram; true too where it cannot be measured. */
export function useFitsRecipeDiagram(ref: RefObject<HTMLElement | null>): boolean {
  const [fits, setFits] = useState(true)
  // Measured before paint, so a narrow column never flashes the diagram before the list.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const check = () => setFits(el.clientWidth >= RECIPE_DIAGRAM_MIN_WIDTH)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return fits
}

/**
 * The Recipe canvas falls back to the ordered list below 768 px and whenever
 * the visitor asks for reduced motion (Plan 019 §3).
 */
export function usePrefersRecipeList(): boolean {
  const narrow = useMediaQuery('(max-width: 767.98px)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  return narrow || reducedMotion
}
