/**
 * FILE: apps/admin/src/components/flow-primitives/StageHoverToolbar.tsx
 * PURPOSE: Floating icon-button toolbar that appears on hover/focus over a
 *          PDCA node. Provides one-click stage actions ("Inspect", "Open
 *          full page") without opening the drawer. Rendered inside each
 *          custom React Flow node, absolutely positioned at the top-right.
 *
 *          Each button is a real <button> with the `.nodrag` class so
 *          React Flow's drag listeners don't swallow the click.
 */

import type { ReactNode } from 'react'

interface ToolbarAction {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void
  /** Disable the button but keep it visible (e.g. when an action is in flight). */
  disabled?: boolean
}

interface StageHoverToolbarProps {
  actions: ToolbarAction[]
  /** When the toolbar parent isn't hovered/focused, make it semi-transparent
   *  so the node stays legible. The actual show/hide is done by the parent's
   *  `group-hover:opacity-100` Tailwind composition. */
  className?: string
}

export function StageHoverToolbar({ actions, className = '' }: StageHoverToolbarProps) {
  if (actions.length === 0) return null
  return (
    <div
      className={[
        'nodrag absolute -top-2 -right-2 flex items-center gap-0.5 rounded-md border border-edge/70 bg-surface-overlay/95 shadow-card p-0.5',
        'opacity-0 pointer-events-none translate-y-0.5',
        'group-hover/pdca:opacity-100 group-hover/pdca:pointer-events-auto group-hover/pdca:translate-y-0',
        'group-focus-within/pdca:opacity-100 group-focus-within/pdca:pointer-events-auto group-focus-within/pdca:translate-y-0',
        'motion-safe:transition-all motion-safe:duration-150',
        className,
      ].join(' ')}
      role="toolbar"
      aria-label="Stage actions"
    >
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          className="nodrag inline-flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:opacity-40 disabled:cursor-not-allowed motion-safe:transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            a.onClick()
          }}
          disabled={a.disabled}
          aria-label={a.label}
          title={a.label}
        >
          {a.icon}
        </button>
      ))}
    </div>
  )
}
