/**
 * FILE: apps/admin/src/components/reports/ReportRowMoreMenu.tsx
 * PURPOSE: The Bugs list row's "More" menu (console polish 2026-11-22). Copy link, open in
 *          a new tab and dismiss were three ~20 px icons side by side: too small to tap on a
 *          touch tablet and easy to hit the wrong one. They now sit behind one trigger, and
 *          on a coarse pointer the trigger and every item are at least 44 px tall.
 *
 *          Placement comes from `useAnchoredPopover` (portal, fixed position, flips above
 *          the trigger near the bottom of the screen), so the table's `overflow-hidden`
 *          never clips it. The panel is a WAI-ARIA menu: focus moves to the first item on
 *          open, ArrowUp/ArrowDown/Home/End move between items, Escape and Tab close it and
 *          return focus to the trigger. Keys and clicks inside it stop there, so the
 *          page's j/k/Enter shortcuts and the row's click-to-open never fire underneath.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPopover } from '../ui'
import { IconClose, IconDots, IconExternalLink, IconShare } from '../icons'

const MENU_WIDTH = 192

const ITEM =
  'flex w-full items-center gap-2 px-2.5 py-1.5 pointer-coarse:min-h-11 text-left text-xs font-medium hover:bg-surface-overlay focus-visible:bg-surface-overlay focus-visible:outline-none'

interface ReportRowMoreMenuProps {
  /** Absolute, base-path-aware URL for "Open in new tab". */
  newTabHref: string
  onCopyLink: () => void
  onDismiss: () => void
}

export function ReportRowMoreMenu({ newTabHref, onCopyLink, onDismiss }: ReportRowMoreMenuProps) {
  const pop = useAnchoredPopover({ width: MENU_WIDTH, align: 'end' })
  const { open, setOpen, close, triggerRef, popoverRef, popoverId, position } = pop

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Nothing typed inside the menu reaches the page's hotkeys (j, k, x, Enter, Space).
    e.stopPropagation()
    const items = menuItems(popoverRef.current)
    const at = items.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => {
      e.preventDefault()
      items[(i + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      // The panel lives at the end of <body>: let Tab go back to the row, not off the page.
      e.preventDefault()
      close()
    }
  }

  const pick = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label="More actions: copy link, open in new tab, dismiss"
        title="More: copy link, open in new tab, dismiss"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-overlay hover:text-fg pointer-coarse:h-11 pointer-coarse:w-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        data-testid="report-row-more"
      >
        <IconDots size={14} />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="menu"
            aria-label="More actions for this report"
            tabIndex={-1}
            style={{
              position: 'fixed',
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              width: MENU_WIDTH,
              visibility: position ? 'visible' : 'hidden',
            }}
            className="z-(--z-top) rounded-sm border border-edge bg-surface-root py-1 shadow-raised outline-none"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onMenuKeyDown}
            // The hook focuses the panel once it is measured; hand that focus to the first item.
            onFocus={(e) => {
              if (e.target === e.currentTarget) menuItems(e.currentTarget)[0]?.focus()
            }}
            data-testid="report-row-more-menu"
          >
            <button type="button" role="menuitem" tabIndex={-1} className={`${ITEM} text-fg`} onClick={pick(onCopyLink)}>
              <IconShare size={12} className="shrink-0 text-fg-muted" />
              Copy link
            </button>
            <a
              role="menuitem"
              tabIndex={-1}
              href={newTabHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`${ITEM} text-fg`}
              onClick={() => setOpen(false)}
            >
              <IconExternalLink size={12} className="shrink-0 text-fg-muted" />
              Open in new tab
            </a>
            <button type="button" role="menuitem" tabIndex={-1} className={`${ITEM} text-danger-foreground`} onClick={pick(onDismiss)}>
              <IconClose size={12} className="shrink-0" />
              Dismiss
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}

function menuItems(panel: HTMLElement | null): HTMLElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]')) : []
}
