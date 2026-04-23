/**
 * FILE: apps/admin/src/lib/useBrushSelection.ts
 * PURPOSE: Wave T.4.7a — headless pointer-driven range selection for
 *          sparklines and time-series charts. Returns pointer handlers +
 *          start/end indexes (with a live `previewStart`/`previewEnd` for
 *          mid-drag rendering).
 *
 * DESIGN NOTES:
 *   - `data.length - 1` is the max index. The hook clamps into [0, max].
 *   - ESC cancels an in-flight drag.
 *   - `pointer: coarse` devices skip registration — touch drags hijack the
 *     scroll gesture and produce accidental selections. Callers provide a
 *     `<SegmentedControl>` fallback in that case per the plan.
 *   - Returns `null` for committed start/end until a drag lands.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface BrushSelection {
  /** Committed start index (0-based into the source array). `null` when no
   *  selection has landed yet or the last one was cancelled. */
  start: number | null
  /** Committed end index, inclusive. `null` when no selection. */
  end: number | null
  /** Live start index during an in-flight drag; `null` otherwise. */
  previewStart: number | null
  /** Live end index during an in-flight drag; `null` otherwise. */
  previewEnd: number | null
  /** Wire to the chart's root element. Returns handlers for the drag. */
  onPointerDown: (e: React.PointerEvent<SVGSVGElement | HTMLDivElement>) => void
  onPointerMove: (e: React.PointerEvent<SVGSVGElement | HTMLDivElement>) => void
  onPointerUp: (e: React.PointerEvent<SVGSVGElement | HTMLDivElement>) => void
  /** Clear any committed or in-flight selection. */
  cancel: () => void
  /** True while the user is actively dragging. */
  isDragging: boolean
}

interface UseBrushSelectionOptions {
  /** Length of the underlying data array. Defines the max valid index. */
  dataLength: number
  /** Fires once per committed selection (pointer-up with movement > 0). */
  onCommit?: (range: { start: number; end: number }) => void
  /** Skip registration when the caller knows the device is touch-only. */
  disabled?: boolean
}

function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: coarse)').matches
}

/**
 * Map a client X coordinate to the nearest data-point index, clamped to
 * [0, dataLength - 1]. Exported for unit tests and for callers that want
 * to compute an index outside of pointer events (e.g. keyboard bindings).
 */
export function brushIndexFromClient(
  clientX: number,
  rect: { left: number; width: number },
  dataLength: number,
): number {
  if (dataLength <= 0) return 0
  // Zero-width container = chart isn't laid out yet; clamp to the first
  // index rather than extrapolating from a divide-by-one that would snap
  // every click to the last point.
  if (rect.width <= 0) return 0
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  const idx = Math.round(ratio * (dataLength - 1))
  return Math.max(0, Math.min(dataLength - 1, idx))
}

/**
 * Normalise a (start, end) pair returned by pointerUp into a low-to-high
 * range. Returns `null` when the user clicked without moving — this is
 * the "clear selection" signal rather than a valid 1-index range.
 */
export function normaliseBrushRange(
  a: number,
  b: number,
): { start: number; end: number } | null {
  const start = Math.min(a, b)
  const end = Math.max(a, b)
  if (start === end) return null
  return { start, end }
}

export function useBrushSelection({
  dataLength,
  onCommit,
  disabled = false,
}: UseBrushSelectionOptions): BrushSelection {
  const [start, setStart] = useState<number | null>(null)
  const [end, setEnd] = useState<number | null>(null)
  const [previewStart, setPreviewStart] = useState<number | null>(null)
  const [previewEnd, setPreviewEnd] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const coarse = useMemo(() => isCoarsePointer(), [])
  const effectivelyDisabled = disabled || coarse || dataLength < 2

  // Keep the commit callback fresh without rewiring pointer handlers.
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  const indexFromClient = useCallback(
    (clientX: number, rect: DOMRect): number =>
      brushIndexFromClient(clientX, { left: rect.left, width: rect.width }, dataLength),
    [dataLength],
  )

  const cancel = useCallback(() => {
    setStart(null)
    setEnd(null)
    setPreviewStart(null)
    setPreviewEnd(null)
    setIsDragging(false)
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement | HTMLDivElement>) => {
      if (effectivelyDisabled) return
      // Only primary button — secondary clicks are for context menus.
      if (e.button !== 0 && e.pointerType === 'mouse') return
      const target = e.currentTarget
      const rect = target.getBoundingClientRect()
      const idx = indexFromClient(e.clientX, rect)
      target.setPointerCapture?.(e.pointerId)
      setPreviewStart(idx)
      setPreviewEnd(idx)
      setIsDragging(true)
    },
    [effectivelyDisabled, indexFromClient],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement | HTMLDivElement>) => {
      if (!isDragging) return
      const rect = e.currentTarget.getBoundingClientRect()
      setPreviewEnd(indexFromClient(e.clientX, rect))
    },
    [isDragging, indexFromClient],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement | HTMLDivElement>) => {
      if (!isDragging) return
      e.currentTarget.releasePointerCapture?.(e.pointerId)
      const a = previewStart ?? 0
      const b = previewEnd ?? a
      const range = normaliseBrushRange(a, b)
      setIsDragging(false)
      if (!range) {
        // Treat a click (no movement) as "clear" rather than a 1-index range.
        setStart(null)
        setEnd(null)
        setPreviewStart(null)
        setPreviewEnd(null)
        return
      }
      setStart(range.start)
      setEnd(range.end)
      setPreviewStart(null)
      setPreviewEnd(null)
      commitRef.current?.(range)
    },
    [isDragging, previewStart, previewEnd],
  )

  useEffect(() => {
    if (!isDragging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isDragging, cancel])

  return {
    start,
    end,
    previewStart,
    previewEnd,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cancel,
    isDragging,
  }
}
