/**
 * FILE: apps/admin/src/components/reports/SortHeader.tsx
 * PURPOSE: Clickable table header that toggles sort direction or switches
 *          field, exposing aria-sort for assistive tech.
 */

import type { SortDir, SortField } from './types'

interface Props {
  label: string
  field: SortField
  current: SortField
  dir: SortDir
  onSort: (f: SortField) => void
  className?: string
}

export function SortHeader({ label, field, current, dir, onSort, className = '' }: Props) {
  const active = current === field
  const arrow = !active ? '' : dir === 'asc' ? '↑' : '↓'
  return (
    <th scope="col" className={`px-2 py-2 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-fg ${active ? 'text-fg' : 'text-fg-faint'}`}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        {arrow && <span className="text-3xs font-mono">{arrow}</span>}
      </button>
    </th>
  )
}
