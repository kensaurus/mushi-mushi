/**
 * FILE: apps/admin/src/components/DataTable.tsx
 * PURPOSE: Shared, typed table primitive built on TanStack Table. All
 *          admin pages that need a sortable column header, row expansion,
 *          or optional row selection should reach for this instead of
 *          rolling their own `<table>`.
 *
 *          Design intent (Wave 3 QOL):
 *            - One component, one look: sticky header, hover/focus state,
 *              keyboard Enter for row click when onRowClick is provided.
 *            - Sort is opt-in per column via `enableSorting` on ColumnDef
 *              so pages keep semantic control (sorting `metadata` is
 *              nonsense; sorting `created_at` is essential).
 *            - Row-expand is controlled by the caller via `expandedIds`
 *              so the component stays stateless and pages can wire
 *              expansion into URL params / keyboard hotkeys.
 *            - Empty / error states are the caller's responsibility
 *              because page context determines the right message.
 *
 * NOTES:
 * - TanStack Table v9: sorting is opt-in via `dataTableFeatures`
 *   (`useTable` + `tableFeatures`). Callers still write
 *   `ColumnDef<Row, unknown>`; the features generic stays inside this file.
 * - The sort registry is the v8 built-in set. A `sortFn` name resolves only
 *   when it is registered. Numeric columns use `basic`.
 * - Rows use `getAllCells()`. `getVisibleCells()` exists only when the
 *   column-visibility feature is registered, which this table does not use.
 */

import {
  type CellData,
  type ColumnDef as TanstackColumnDef,
  type OnChangeFn,
  type RowData,
  type SortingState,
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_alphanumericCaseSensitive,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  sortFn_textCaseSensitive,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { Fragment, type ReactNode, useState } from 'react'

/** Client-side sorting only. Core rows are always included; other features stay out of the bundle. */
const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    alphanumericCaseSensitive: sortFn_alphanumericCaseSensitive,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
    textCaseSensitive: sortFn_textCaseSensitive,
  },
})

type DataTableFeatures = typeof dataTableFeatures

export type ColumnDef<TData extends RowData, TValue extends CellData = CellData> =
  TanstackColumnDef<DataTableFeatures, TData, TValue>

interface DataTableProps<T extends RowData> {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  /** Stable unique id accessor — used as React key and for expansion. */
  getRowId: (row: T) => string
  /** Optional custom row body rendered beneath the row when the row id
   *  appears in `expandedIds`. Kept stateless so caller owns expansion
   *  state (can be URL-synced, or driven by keyboard hotkeys). */
  renderExpanded?: (row: T) => ReactNode
  expandedIds?: ReadonlySet<string>
  /** Controlled sort state. If omitted, the table manages it internally. */
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  /** Row click handler — receives the original row. Entire row becomes a
   *  hit target with keyboard `Enter` support when provided. */
  onRowClick?: (row: T) => void
  /** Compact lines-per-row — flips `py` and `text-size` to save vertical
   *  real-estate on dense pages (audit, activity). */
  density?: 'default' | 'compact' | 'comfortable'
  /** Hide the column header row — useful when the table rides under
   *  existing filter/header UI and would otherwise look redundant. */
  hideHeader?: boolean
  /** Aria label for the table, especially important when header is
   *  hidden so screen readers still know what they're reading. */
  ariaLabel?: string
  className?: string
}

const DENSITY_ROW: Record<'default' | 'compact' | 'comfortable', string> = {
  compact:     'py-1 text-2xs',
  default:     'py-1.5 text-xs',
  comfortable: 'py-2.5 text-sm',
}

const DENSITY_HEAD: Record<'default' | 'compact' | 'comfortable', string> = {
  compact:     'py-1 text-3xs',
  default:     'py-1.5 text-2xs',
  comfortable: 'py-2 text-2xs',
}

export function DataTable<T extends RowData>({
  data,
  columns,
  getRowId,
  renderExpanded,
  expandedIds,
  sorting: controlledSorting,
  onSortingChange,
  onRowClick,
  density = 'default',
  hideHeader = false,
  ariaLabel,
  className = '',
}: DataTableProps<T>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>([])

  const sorting = controlledSorting ?? internalSorting
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    if (onSortingChange) onSortingChange(updater)
    else {
      setInternalSorting((prev) =>
        typeof updater === 'function' ? (updater as (s: SortingState) => SortingState)(prev) : updater,
      )
    }
  }

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    state: { sorting },
    onSortingChange: handleSortingChange,
    getRowId,
  })

  const rows = table.getRowModel().rows

  const rowClasses = DENSITY_ROW[density]
  const headClasses = DENSITY_HEAD[density]
  const colCount = columns.length

  return (
    <div className={`overflow-x-auto rounded-sm border border-edge/60 ${className}`}>
      <table
        aria-label={ariaLabel}
        className="w-full border-collapse text-left"
      >
        {!hideHeader && (
          <thead className="sticky top-0 z-10 bg-surface-raised/95 backdrop-blur-sm">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-edge/60">
                {group.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sortDir = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none'
                      }
                      className={`px-3 font-semibold uppercase tracking-wider text-fg-muted ${headClasses}`}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-fg focus-visible:outline-none focus-visible:text-fg"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span aria-hidden className="text-fg-faint">
                            {sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : '↕'}
                          </span>
                        </button>
                      ) : (
                        <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
        )}
        <tbody>
          {rows.map((row) => {
            const id = row.id
            const isExpanded = Boolean(expandedIds?.has(id))
            return (
              <Fragment key={id}>
                <tr
                  tabIndex={onRowClick ? 0 : -1}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            onRowClick(row.original)
                          }
                        }
                      : undefined
                  }
                  className={`border-b border-edge/30 motion-safe:transition-opacity ${
                    onRowClick
                      ? 'cursor-pointer hover:bg-surface-overlay/50 focus-visible:outline-none focus-visible:bg-surface-overlay/70 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand/50'
                      : ''
                  }`}
                >
                  {row.getAllCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={`px-3 align-middle ${rowClasses}`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {renderExpanded && isExpanded && (
                  <tr className="bg-surface-overlay/30 border-b border-edge/30">
                    <td colSpan={colCount} className="px-3 py-2">
                      {renderExpanded(row.original)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
