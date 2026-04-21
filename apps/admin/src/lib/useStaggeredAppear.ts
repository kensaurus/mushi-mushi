/**
 * FILE: apps/admin/src/lib/useStaggeredAppear.ts
 * PURPOSE: Tiny helper that returns a `style` prop for each item in a list
 *          so consecutive children fade in with a small stagger. Used by
 *          dashboard rows and tables that previously popped in all at once
 * when fresh data arrived
 *
 *          Usage:
 *            const stagger = useStaggeredAppear({ stepMs: 40, max: 12 })
 *            items.map((item, i) => (
 *              <li key={item.id} style={stagger(i)} className="motion-safe:animate-mushi-fade-in">
 *                ...
 *              </li>
 *            ))
 *
 *          The hook deliberately returns a function and not pre-baked
 *          styles so callers can call it inside `.map()` without any extra
 *          allocations on re-render. The cap prevents long lists from
 *          finishing the entrance animation seconds after they appeared.
 */

import { useCallback } from 'react'

export interface UseStaggeredAppearOptions {
  /** Delay between consecutive items, in ms. Defaults to 35ms. */
  stepMs?: number
  /** Cap the cumulative delay at this index. Defaults to 10 (so item 11+
   *  shares the same delay as item 10). Keeps large lists snappy. */
  max?: number
  /** Optional starting delay applied to index 0. Defaults to 0. */
  baseMs?: number
}

export function useStaggeredAppear(opts: UseStaggeredAppearOptions = {}) {
  const { stepMs = 35, max = 10, baseMs = 0 } = opts
  return useCallback(
    (index: number): React.CSSProperties => {
      const idx = Math.max(0, Math.min(index, max))
      const delay = baseMs + idx * stepMs
      return {
        animationDelay: `${delay}ms`,
        // Backfill the keyframe origin state so the very first paint
        // doesn't briefly show the item at full opacity before the
        // delay starts the keyframe.
        animationFillMode: 'both',
      }
    },
    [baseMs, max, stepMs],
  )
}
