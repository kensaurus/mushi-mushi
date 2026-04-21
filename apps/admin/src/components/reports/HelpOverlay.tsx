/**
 * FILE: apps/admin/src/components/reports/HelpOverlay.tsx
 * PURPOSE: Keyboard-shortcut help surfaced on ReportsPage via the `?` key.
 *          Uses the shared Modal primitive so it inherits viewport-safe
 *          sizing, focus trap, and Esc-close for free.
 */

import { Modal } from '../Modal'

interface Props {
  onClose: () => void
}

export function HelpOverlay({ onClose }: Props) {
  return (
    <Modal open size="sm" title="Keyboard shortcuts" onClose={onClose}>
      <dl className="space-y-1.5 text-xs">
        <ShortcutRow k="j / k" desc="Move cursor down / up" />
        <ShortcutRow k="Enter" desc="Open focused report" />
        <ShortcutRow k="x" desc="Toggle selection" />
        <ShortcutRow k="a" desc="Select all on page" />
        <ShortcutRow k="/" desc="Focus search" />
        <ShortcutRow k="[ / ]" desc="Previous / next page" />
        <ShortcutRow k="Esc" desc="Clear selection / close" />
        <ShortcutRow k="?" desc="Toggle this help" />
      </dl>
    </Modal>
  )
}

function ShortcutRow({ k, desc }: { k: string; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-muted">{desc}</span>
      <span className="font-mono text-2xs text-fg">{k}</span>
    </div>
  )
}
