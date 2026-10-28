/**
 * FILE: apps/admin/src/components/DisplayPreferences.tsx
 * PURPOSE: How the console looks in this browser: theme, density, table rows
 *          and focus mode, each with its name written out. Shown in the account menu
 *          (sidebar footer) and on Settings › Display. These used to be three
 *          rows of unlabelled icons at the foot of the sidebar, plus a table-row switch
 *          inside the Bugs, Fixes and Compliance tables
 *          (owner, 2026-10-27: display settings belong in settings or the
 *          profile, not on the page).
 */

import { SegmentedControl, Toggle } from './ui'
import { useDensity, type Density } from '../lib/useDensity'
import { useTheme, type Theme } from '../lib/useTheme'
import { useTableDensity, type TableDensity } from '../lib/useTableDensity'

const THEMES: ReadonlyArray<{ id: Theme; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
]

const TABLE_ROWS: ReadonlyArray<{ id: TableDensity; label: string }> = [
  { id: 'compact', label: 'Compact' },
  { id: 'comfy', label: 'Comfortable' },
]

const DENSITIES: ReadonlyArray<{ id: Density; label: string }> = [
  { id: 'compact', label: 'Compact' },
  { id: 'default', label: 'Standard' },
  { id: 'comfortable', label: 'Comfortable' },
]

export function DisplayPreferences({
  focusMode,
  onFocusChange,
  layout = 'menu',
}: {
  focusMode: boolean
  onFocusChange: (next: boolean) => void
  /** `menu`: tight rows for the account menu; `page`: Settings › Display. */
  layout?: 'menu' | 'page'
}) {
  const { theme, setTheme } = useTheme()
  const { density, setDensity } = useDensity()
  const [tableRows, setTableRows] = useTableDensity()
  const row = layout === 'menu' ? 'flex items-center justify-between gap-2 px-2 py-1' : 'flex flex-wrap items-center justify-between gap-3 py-2'
  const name = layout === 'menu' ? 'text-2xs font-medium text-fg-secondary' : 'text-sm font-medium text-fg'

  return (
    <div className={layout === 'menu' ? 'space-y-0.5' : 'divide-y divide-edge-subtle'} data-testid={`display-preferences-${layout}`}>
      <div className={row}>
        <span className={name}>Theme</span>
        <SegmentedControl value={theme} options={THEMES} onChange={setTheme} ariaLabel="Theme" size="sm" />
      </div>
      <div className={row}>
        <span className={name}>Density</span>
        <SegmentedControl value={density} options={DENSITIES} onChange={setDensity} ariaLabel="Density" size="sm" />
      </div>
      <div className={row}>
        <span className={name}>Table rows</span>
        <SegmentedControl value={tableRows} options={TABLE_ROWS} onChange={setTableRows} ariaLabel="Table rows" size="sm" />
      </div>
      <div className={row}>
        <span className={name}>
          Focus mode
          {layout === 'page' ? (
            <span className="block text-xs font-normal text-fg-muted">Hides the sidebar and header. Ctrl/Cmd + . toggles it, Esc exits.</span>
          ) : null}
        </span>
        <Toggle ariaLabel="Focus mode" label={focusMode ? 'On' : 'Off'} checked={focusMode} onChange={onFocusChange} />
      </div>
    </div>
  )
}
