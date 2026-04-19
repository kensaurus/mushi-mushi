/**
 * FILE: apps/admin/src/components/reports/HelpOverlay.tsx
 * PURPOSE: Modal overlay listing keyboard shortcuts available on the
 *          ReportsPage. Closes on backdrop click and exposes proper
 *          dialog semantics.
 */

interface Props {
  onClose: () => void
}

export function HelpOverlay({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-edge rounded-md shadow-raised p-4 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-fg">Keyboard shortcuts</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-fg-faint hover:text-fg text-xs px-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
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
      </div>
    </div>
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
