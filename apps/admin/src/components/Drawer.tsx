/**
 * FILE: apps/admin/src/components/Drawer.tsx
 * PURPOSE: Right-anchored sliding panel primitive. Shares Modal's focus-
 *          trap, Esc-close, and backdrop-dismiss guarantees but leaves
 *          the page behind it readable so users can triage the stream
 *          while still seeing the list they're working on.
 *
 *          Used by ActivityDrawer (live fix_events feed) and
 *          SplitViewDrawer (report preview on /reports).
 */

import { useEffect, useRef } from 'react'
import type { ReactNode, MouseEvent } from 'react'

type DrawerWidth = 'sm' | 'md' | 'lg'

const WIDTH_CLASS: Record<DrawerWidth, string> = {
  sm: 'w-full sm:w-[22rem]',
  md: 'w-full sm:w-[28rem]',
  lg: 'w-full sm:w-[36rem]',
}

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  ariaLabel?: string
  /** Optional toolbar rendered in the header, right of the title. */
  headerAction?: ReactNode
  footer?: ReactNode
  children: ReactNode
  width?: DrawerWidth
  dismissible?: boolean
  /** If false, the backdrop is transparent (no dimming) — use when the
   *  drawer needs to coexist with the page behind it, e.g. a split-view
   *  report preview where the list should stay readable. Defaults true. */
  dimmed?: boolean
}

export function Drawer({
  open,
  onClose,
  title,
  ariaLabel,
  headerAction,
  footer,
  children,
  width = 'md',
  dismissible = true,
  dimmed = true,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const prevFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement as HTMLElement | null

    const prevOverflow = document.body.style.overflow
    // Dimmed drawers suppress body scroll to match the Modal convention;
    // undimmed drawers leave the page scrollable so the user can keep
    // reading the main content while the drawer sits open.
    if (dimmed) document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    const focusable = panel?.querySelectorAll<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"]), a[href]',
    )
    ;(focusable?.[0] ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = panel.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]',
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      prevFocusRef.current?.focus?.()
    }
  }, [open, dismissible, onClose, dimmed])

  if (!open) return null

  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!dismissible) return
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : ariaLabel}
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onBackdropClick}
    >
      {dimmed && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-overlay backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
        />
      )}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`relative h-full ${WIDTH_CLASS[width]} bg-surface-root border-l border-edge/60 shadow-raised flex flex-col motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200 focus:outline-none`}
      >
        {(title || headerAction) && (
          <header className="flex items-center gap-3 px-4 py-2.5 border-b border-edge/60">
            <div className="min-w-0 flex-1">
              {typeof title === 'string' ? (
                <h2 className="text-sm font-semibold text-fg truncate">{title}</h2>
              ) : (
                title
              )}
            </div>
            {headerAction}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M6 6l12 12M18 6l-12 12" strokeLinecap="round" />
              </svg>
            </button>
          </header>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-edge/60 px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  )
}
