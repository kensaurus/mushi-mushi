/**
 * FILE: apps/admin/src/components/pipeline/MoreActionsMenu.tsx
 * PURPOSE: The "More" menu beside a pipeline group's one primary button (2026-11-18: some rows
 *          showed five buttons). Same dismissal as ChartActionsMenu (a click outside or Escape
 *          closes it, focus returns to the trigger), but its items keep what the old buttons
 *          had: disabled with the server's reason as a tooltip, a busy state, and a test id.
 *          ChartActionsMenu's `extraItems` has none of these, hence this small local menu.
 */

import { useEffect, useRef, useState } from 'react'
import { IconChevronDown } from '../icons'

interface MoreAction {
  key: string
  label: string
  onSelect: () => void
  disabled?: boolean
  busy?: boolean
  /** Tooltip: why it is off, or how many items can take it. */
  title?: string
  describedBy?: string
  testId?: string
  /** Closes or removes something: red ink. */
  danger?: boolean
}

export function MoreActionsMenu({ actions, label, testId }: { actions: readonly MoreAction[]; label: string; testId: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (actions.length === 0) return null
  const busy = actions.some((a) => a.busy)
  return (
    <span ref={box} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${actions.length} more ${actions.length === 1 ? 'action' : 'actions'}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-0.5 rounded-sm border border-edge bg-surface-raised px-2 text-2xs font-semibold text-fg hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        data-testid={testId}
      >
        {busy ? 'Working…' : 'More'}
        <IconChevronDown size={12} className={`motion-safe:transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="menu" aria-label={`${label}: more actions`} className="ci-rise absolute top-full right-0 z-20 mt-1 min-w-44 rounded-sm border border-edge bg-surface-root py-1 shadow-raised">
          {actions.map((a) => (
            <li key={a.key} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={a.disabled || a.busy}
                title={a.title}
                aria-describedby={a.describedBy}
                onClick={() => {
                  setOpen(false)
                  a.onSelect()
                }}
                className={`w-full px-2.5 py-1 text-left text-xs font-medium hover:bg-surface-overlay disabled:cursor-not-allowed disabled:text-fg-faint disabled:hover:bg-transparent ${
                  a.danger ? 'text-danger-foreground' : 'text-fg'
                }`}
                data-testid={a.testId}
              >
                {a.busy ? `${a.label}…` : a.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
