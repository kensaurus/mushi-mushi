/**
 * FILE: apps/admin/src/components/DensitySidebarToggle.tsx
 * PURPOSE: 3-way segmented control in the sidebar footer that flips the
 *          global UI density. Compact = more rows per screen (triage
 *          power users); Comfortable = bigger targets (tablet / touch).
 *
 *          Intentionally tiny and text-only — the sidebar footer is
 *          also home to the theme toggle and sign-out button, so the
 *          density control has to fit alongside them without shouting.
 */

import { useDensity, type Density } from '../lib/useDensity'

const OPTIONS: Array<{ value: Density; label: string; hint: string }> = [
  { value: 'compact',     label: 'Cmp', hint: 'Compact — fits the most rows' },
  { value: 'default',     label: 'Std', hint: 'Default density' },
  { value: 'comfortable', label: 'Cmf', hint: 'Comfortable — roomier, touch-friendly' },
]

export function DensitySidebarToggle() {
  const { density, setDensity } = useDensity()
  return (
    <div
      role="radiogroup"
      aria-label="UI density"
      className="flex items-center gap-0.5 rounded-sm border border-edge/60 p-0.5"
    >
      {OPTIONS.map((o) => {
        const active = density === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setDensity(o.value)}
            title={o.hint}
            className={`flex-1 rounded-sm px-1 py-0.5 text-2xs font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 ${
              active
                ? 'bg-surface-overlay text-fg'
                : 'text-fg-muted hover:text-fg hover:bg-surface-overlay/60'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
