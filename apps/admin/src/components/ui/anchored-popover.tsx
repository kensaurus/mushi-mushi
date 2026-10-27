// mushi-ui: intentional overlay — not Modal/Drawer (reason: non-modal anchored popover with viewport flip + scroll; the page stays usable)
/**
 * FILE: apps/admin/src/components/ui/anchored-popover.tsx
 * PURPOSE: A click-to-open, non-modal popover anchored to its trigger.
 *          Extracted from ConfigHelp so the field help and the page's
 *          "How this page works" help share one placement and dismissal
 *          behaviour:
 *
 *            - click opens (hover-only fails on touch and for keyboards);
 *            - role="dialog" + aria-modal="false" (WAI-ARIA APG non-modal
 *              popover): the page stays usable while it is open;
 *            - Escape and a click outside close it; focus moves into the
 *              popover on open and back to the trigger on close;
 *            - fixed position in a portal, so no ancestor `overflow:hidden`
 *              clips it; flips above the trigger when there is no room
 *              below, and caps its height to the room it has (the body
 *              scrolls instead of leaving the viewport).
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

const POPOVER_GUTTER = 12 // px breathing room between popover and viewport edge
const POPOVER_OFFSET = 6 // px gap between trigger and popover

interface PopoverPosition {
  top: number
  left: number
  side: 'top' | 'bottom'
  /** Height cap on the chosen side; the body scrolls past it. */
  maxHeight: number
}

export interface AnchoredPopoverState {
  open: boolean
  setOpen: (next: boolean | ((prev: boolean) => boolean)) => void
  /** Close and return focus to the trigger. */
  close: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  popoverRef: RefObject<HTMLDivElement | null>
  /** Stable id for `aria-controls` on the trigger and `id` on the panel. */
  popoverId: string
  titleId: string
  position: PopoverPosition | null
  width: number
}

/**
 * Open state, placement and dismissal for one anchored popover. `align`
 * picks which trigger edge the popover lines up with: `start` (left edge,
 * for a field label) or `end` (right edge, for a header's right corner).
 */
export function useAnchoredPopover({
  width,
  align = 'start',
  onOpenChange,
}: {
  width: number
  align?: 'start' | 'end'
  onOpenChange?: (open: boolean) => void
}): AnchoredPopoverState {
  const [open, setOpenState] = useState(false)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const reactId = useId()
  const popoverId = `popover-${reactId}`
  const titleId = `${popoverId}-title`
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  const openRef = useRef(false)

  // The callback runs here, not inside a state updater: updaters must stay
  // pure (StrictMode calls them twice).
  const setOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(openRef.current) : next
    if (value === openRef.current) return
    openRef.current = value
    setOpenState(value)
    onOpenChangeRef.current?.(value)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    // Next tick: React has unmounted the panel by then.
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [setOpen])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    function onClickAway(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (popoverRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onClickAway)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onClickAway)
    }
  }, [open, close, setOpen])

  const recompute = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Measure the natural height so the flip decision is about what the
    // popover wants to be, not the height a previous frame clamped it to.
    const naturalHeight = popoverRef.current?.scrollHeight ?? popoverRef.current?.offsetHeight ?? 280
    const spaceBelow = vh - rect.bottom - POPOVER_OFFSET - POPOVER_GUTTER
    const spaceAbove = rect.top - POPOVER_OFFSET - POPOVER_GUTTER
    let side: 'top' | 'bottom'
    if (spaceBelow >= naturalHeight) side = 'bottom'
    else if (spaceAbove >= naturalHeight) side = 'top'
    else side = spaceAbove > spaceBelow ? 'top' : 'bottom'
    // Floor at 160px: partial visibility beats a collapsed popover.
    const maxHeight = Math.max(160, side === 'bottom' ? spaceBelow : spaceAbove)
    const renderedHeight = Math.min(naturalHeight, maxHeight)
    const top =
      side === 'bottom' ? rect.bottom + POPOVER_OFFSET : Math.max(POPOVER_GUTTER, rect.top - POPOVER_OFFSET - renderedHeight)
    const actualWidth = Math.min(width, vw - POPOVER_GUTTER * 2)
    const maxLeft = vw - actualWidth - POPOVER_GUTTER
    const desiredLeft = align === 'end' ? rect.right - actualWidth : rect.left
    const left = Math.max(POPOVER_GUTTER, Math.min(desiredLeft, maxLeft))
    setPosition({ top, left, side, maxHeight })
  }, [width, align])

  // Two passes: a synchronous one with the fallback height so the first
  // paint is never at (0,0), then one after mount with the real height.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    recompute()
    const raf = requestAnimationFrame(() => {
      if (!triggerRef.current || !popoverRef.current) return
      recompute()
      popoverRef.current.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [open, recompute])

  // Stay anchored while any ancestor scrolls (capture) or the window resizes.
  useEffect(() => {
    if (!open) return
    const onChange = () => recompute()
    window.addEventListener('scroll', onChange, true)
    window.addEventListener('resize', onChange)
    return () => {
      window.removeEventListener('scroll', onChange, true)
      window.removeEventListener('resize', onChange)
    }
  }, [open, recompute])

  return { open, setOpen, close, triggerRef, popoverRef, popoverId, titleId, position, width }
}

/** The portalled panel for a `useAnchoredPopover` state. Renders nothing while closed. */
export function AnchoredPopoverPanel({
  state,
  className = '',
  children,
}: {
  state: AnchoredPopoverState
  className?: string
  children: ReactNode
}) {
  const { open, popoverRef, popoverId, titleId, position, width } = state
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={popoverRef}
      id={popoverId}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{
        position: 'fixed',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        width,
        maxWidth: `calc(100vw - ${POPOVER_GUTTER * 2}px)`,
        maxHeight: position?.maxHeight ?? undefined,
        // Hidden until the first measurement so it never flashes at (0,0).
        visibility: position ? 'visible' : 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
      className={`z-(--z-top) rounded-md border outline-none tooltip-enter ${className}`}
      onClick={(e) => e.stopPropagation()}
      data-side={position?.side ?? 'bottom'}
    >
      {children}
    </div>,
    document.body,
  )
}
