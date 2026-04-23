/**
 * FILE: apps/admin/src/components/Modal.tsx
 * PURPOSE: Single overlay/dialog primitive every modal in the admin uses.
 *
 *          Replaces the 5+ hand-rolled overlay snippets that each duplicated
 *          the same Tailwind string (ConfirmDialog/DialogShell,
 *          PromptEditorModal, PromptDiffModal, GroupsPanel merge,
 *          HelpOverlay). Those all suffered the same viewport bug: no
 *          max-height + no inner scroll, so on short screens the card
 *          clipped below the fold.
 *
 *          Design:
 *            - `dvh` (not `vh`) so mobile Safari's dynamic URL bar doesn't
 *              push the panel below the viewport.
 *            - `flex flex-col` + `min-h-0` on the body so the scroll lives
 *              inside the panel, never the page.
 *            - Focus trap + Esc-close + body scroll lock centralised here.
 *            - Backdrop click closes unless `dismissible={false}` (used while
 *              a destructive action is in flight so the user can't escape
 *              halfway).
 */

import { useEffect, useRef } from 'react'
import type { ReactNode, MouseEvent } from 'react'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
  full: 'max-w-[min(96rem,95vw)]',
}

interface ModalProps {
  /** Whether the modal is mounted/visible. Conditionally render — hook order is safe. */
  open: boolean
  onClose: () => void
  title?: ReactNode
  /** Optional ariaLabel when title is a ReactNode rather than a string. */
  ariaLabel?: string
  /** Right side of header, e.g. meta badge. */
  headerAction?: ReactNode
  /** Footer renders below the scrolling body with a top border. */
  footer?: ReactNode
  children: ReactNode
  size?: ModalSize
  /** Pass false to disable backdrop click + Esc (for in-flight destructive ops). */
  dismissible?: boolean
  /** Suppress the X close button (rare — use for wizards with explicit Cancel). */
  hideCloseButton?: boolean
  className?: string
}

export function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  headerAction,
  footer,
  children,
  size = 'md',
  dismissible = true,
  hideCloseButton,
  className = '',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  // Ref-latch `onClose` — see `Drawer.tsx` for the full rationale.
  // Summary: ancestors re-render on every realtime `postgres_changes`
  // tick, callers pass inline arrows for `onClose`, so depending on
  // `onClose` identity would rip focus out of the modal every few
  // seconds. Refs can be written during render; this is the same shape
  // used by `useRealtimeReload`.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    // Focus the first focusable element in the panel for keyboard users.
    // Fallback to the panel itself so Esc / Tab work even when the body has
    // no focusable child (e.g. a bare info dialog).
    const focusable = panel?.querySelectorAll<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"]), a[href]',
    )
    const primary = panel?.querySelector<HTMLElement>('[data-primary]')
    ;(primary ?? focusable?.[0] ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation()
        onCloseRef.current()
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
      previouslyFocusedRef.current?.focus?.()
    }
  }, [open, dismissible])

  if (!open) return null

  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!dismissible) return
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-overlay backdrop-blur-sm p-3 motion-safe:animate-mushi-fade-in overflow-y-auto"
      onClick={onBackdropClick}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={[
          'w-full flex flex-col rounded-md border border-edge bg-surface-raised shadow-raised',
          'max-h-[min(90dvh,48rem)] motion-safe:animate-mushi-modal-in outline-none',
          SIZE_CLASS[size],
          className,
        ].join(' ')}
      >
        {(title || headerAction || !hideCloseButton) && (
          <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {title && (
                <h3 className="text-sm font-semibold text-fg truncate">{title}</h3>
              )}
              {headerAction}
            </div>
            {!hideCloseButton && (
              <button
                type="button"
                className="text-fg-muted hover:text-fg text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-sm w-6 h-6 flex items-center justify-center motion-safe:transition-colors motion-safe:duration-[var(--duration-fast,150ms)]"
                onClick={onClose}
                aria-label="Close"
                disabled={!dismissible}
              >
                ×
              </button>
            )}
          </header>
        )}
        <div className="px-4 pb-3 pt-1 overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer && (
          <footer className="px-4 py-3 border-t border-edge/50 flex-shrink-0 flex flex-wrap justify-end gap-1.5 bg-surface-raised/40">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
