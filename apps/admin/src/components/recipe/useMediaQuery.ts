/**
 * FILE: apps/admin/src/components/recipe/useMediaQuery.ts
 * PURPOSE: When the Recipe page shows its ordered list instead of the canvas.
 */

import { useMediaQuery } from '../../lib/useMediaQuery'

/**
 * The Recipe canvas falls back to the ordered list below 768 px and whenever
 * the visitor asks for reduced motion (Plan 019 §3).
 */
export function usePrefersRecipeList(): boolean {
  const narrow = useMediaQuery('(max-width: 767.98px)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  return narrow || reducedMotion
}
