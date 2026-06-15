/**
 * FILE: apps/admin/src/components/reports/SortHeader.tsx
 * PURPOSE: Clickable table header that toggles sort direction or switches
 *          field, exposing aria-sort for assistive tech.
 */

import type { SortDir, SortField } from './types'

interface Props {
  label: string
  /** Full meaning when `label` is an abbreviation (renders as `<abbr title>`
   *  with a dotted underline so screen readers + hover pick up the long form). */
  fullLabel?: string
  field: SortField
  current: SortField
  dir: SortDir
  onSort: (f: SortField) => void
  className?: string
  align?: 'left' | 'right' | 'center'
  /** Horizontal padding class forwarded to `<th>` (defaults to px-2). */
  cellPx?: string
}

export function SortHeader({
  label,
  fullLabel,
  field,
  current,
  dir,
  onSort,
  className = '',
  align = 'left',
  cellPx = 'px-2',
}: Props) {
  const active = current === field
  const arrow = !active ? '' : dir === 'asc' ? '↑' : '↓'
  const labelNode = fullLabel ? (
    <abbr title={fullLabel} className="cursor-help no-underline border-b border-dotted border-fg-faint/40">
      {label}
    </abbr>
  ) : (
    label
  )
  const alignCls =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  const btnCls =
    align === 'right'
      ? 'w-full min-w-0 justify-end'
      : align === 'center'
        ? 'w-full min-w-0 justify-center'
        : 'w-full min-w-0 justify-start'
  return (
    <th scope="col" className={`${cellPx} py-2 font-medium ${alignCls} ${className}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-fg ${active ? 'text-fg' : 'text-fg-faint'} ${btnCls}`}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        aria-label={fullLabel ? `Sort by ${fullLabel}` : `Sort by ${label}`}
      >
        {labelNode}
        {arrow && <span className="text-2xs font-mono leading-none">{arrow}</span>}
      </button>
    </th>
  )
}
