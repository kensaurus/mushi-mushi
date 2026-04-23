/**
 * FILE: apps/admin/src/components/ThemeSidebarToggle.tsx
 * PURPOSE: Dark / light / system theme toggle in the sidebar footer.
 *          Renders the same three-segment control as the density toggle
 *          so the two sit flush and read as a matched pair.
 */

import { useTheme, type Theme } from '../lib/useTheme'

const OPTIONS: Array<{ value: Theme; label: string; hint: string }> = [
  { value: 'dark',   label: 'Dark',  hint: 'Dark theme — the default, designed for low-light triage' },
  { value: 'light',  label: 'Light', hint: 'Light theme — high ambient light / printing' },
  { value: 'system', label: 'Auto',  hint: 'Follow OS appearance' },
]

export function ThemeSidebarToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-sm border border-edge/60 p-0.5"
    >
      {OPTIONS.map((o) => {
        const active = theme === o.value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(o.value)}
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
