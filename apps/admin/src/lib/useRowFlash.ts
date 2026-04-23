/**
 * FILE: apps/admin/src/lib/useRowFlash.ts
 * PURPOSE: Wave T.2.5 — fire a one-shot background wash on a row when its
 *          status / severity value transitions to a new value. Used by
 *          `ReportRowView` and `FixCard` so live realtime updates feel
 *          alive without being noisy.
 *
 * DESIGN:
 *   - Tracks `value` against a ref'd previous value; skips the animation
 *     on mount (ref starts equal to the current value).
 *   - Emits `{ className, style, onAnimationEnd }` the caller spreads on
 *     the row element. `className` toggles the keyframe, and the
 *     `--flash-tone` CSS var on `style` lets the caller pick a tone
 *     without adding a new tailwind variant.
 *   - Skips entirely when `document.visibilityState !== 'visible'` so
 *     returning to a tab after 10 minutes doesn't light up every row.
 *   - Skips on `prefers-reduced-motion` through the `.animate-*` class
 *     being inside a `motion-safe:` wrapper at the call site — the hook
 *     itself is motion-agnostic so existing `@media (prefers-reduced-
 *     motion)` CSS continues to win.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'

export interface UseRowFlashOptions<T extends string> {
  /** Stable key that survives realtime updates (usually the row id). */
  rowKey: string
  /** The flashable value — typically `status` or `severity`. Each change
   *  fires a one-shot flash. */
  value: T
  /** Map from each possible value to a CSS colour token or variable. */
  toneFor: (value: T) => string
}

export interface RowFlashProps {
  className: string
  style: CSSProperties
  onAnimationEnd: () => void
}

export function useRowFlash<T extends string>({
  rowKey,
  value,
  toneFor,
}: UseRowFlashOptions<T>): RowFlashProps {
  // Track previous value + row identity together so a row recycled into a
  // different id (virtualised list) doesn't falsely flash.
  const prevRef = useRef<{ key: string; value: T }>({ key: rowKey, value })
  const [flashing, setFlashing] = useState(false)
  const [tone, setTone] = useState<string | null>(null)

  useEffect(() => {
    const prev = prevRef.current
    // Row identity changed → treat this as the "first render" for the new
    // row; no flash. Stamp the ref and bail.
    if (prev.key !== rowKey) {
      prevRef.current = { key: rowKey, value }
      return
    }
    if (prev.value === value) return
    prevRef.current = { key: rowKey, value }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return
    }
    setTone(toneFor(value))
    setFlashing(true)
  }, [rowKey, value, toneFor])

  return {
    className: flashing ? 'motion-safe:animate-mushi-row-flash' : '',
    style: tone ? ({ ['--flash-tone' as unknown as keyof CSSProperties]: tone } as CSSProperties) : {},
    onAnimationEnd: () => {
      // Let the next transition re-fire — the keyframe is one-shot so we
      // have to actively pop the class off after it ends, otherwise the
      // browser keeps the final frame applied.
      setFlashing(false)
    },
  }
}
