/**
 * FILE: apps/admin/src/components/flow-primitives/StageDrawer.tsx
 * PURPOSE: Accessible right-side drawer opened when the user clicks a PDCA
 *          stage node. Uses the same focus-trap / Esc-close / body-scroll-
 *          lock contract as `<Modal>` but lives as a persistent sheet so
 *          the user can see the underlying flow while inspecting the stage.
 *
 *          Keeps the implementation small: plain fixed-position div — no
 *          portal library, no native <dialog> (which on Safari still has
 *          quirky scroll/focus edge cases). Parent controls `open`.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface StageDrawerProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Tone chip rendered beside the title — e.g. P/D/C/A letter badge. */
  titleAccent?: ReactNode
  /** Compact "what is this stage" copy under the title. */
  subtitle?: string
  /** Bottom footer; use for primary action buttons. */
  footer?: ReactNode
  children: ReactNode
  /** When true, the drawer is anchored bottom on mobile, right on desktop. */
  className?: string
}

export function StageDrawer({
  open,
  onClose,
  title,
  titleAccent,
  subtitle,
  footer,
  children,
  className = '',
}: StageDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusable = panel?.querySelectorAll<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"]), a[href]',
    )
    const primary = panel?.querySelector<HTMLElement>('[data-primary]')
    ;(primary ?? focusable?.[0] ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
      previouslyFocusedRef.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-stretch sm:justify-end motion-safe:animate-mushi-drawer-backdrop-in"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="absolute inset-0 bg-overlay/70 backdrop-blur-[2px] focus:outline-none"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Stage details'}
        tabIndex={-1}
        className={[
          'relative flex w-full sm:w-[28rem] sm:max-w-[92vw] max-h-[92dvh] sm:max-h-none sm:h-full',
          'flex-col rounded-t-lg sm:rounded-none sm:rounded-l-lg border border-edge/70 bg-surface-raised shadow-raised',
          'motion-safe:animate-mushi-drawer-in outline-none',
          className,
        ].join(' ')}
      >
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-edge/50">
          <div className="flex items-start gap-2 min-w-0">
            {titleAccent}
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg leading-tight truncate">{title}</h3>
              {subtitle && (
                <p className="text-2xs text-fg-muted mt-0.5 leading-snug line-clamp-2">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-fg-muted hover:text-fg text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-sm w-6 h-6 flex items-center justify-center motion-safe:transition-colors"
          >
            ×
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-1.5 border-t border-edge/50 bg-surface-raised/40 px-4 py-2.5">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  )
}
