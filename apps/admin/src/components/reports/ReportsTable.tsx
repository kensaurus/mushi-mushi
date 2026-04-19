/**
 * FILE: apps/admin/src/components/reports/ReportsTable.tsx
 * PURPOSE: Sortable, paginated triage table. Owns the table chrome (header,
 *          pagination footer) and renders each row via ReportRowView.
 *          All mutations bubble back to the page through callbacks.
 */

import { Btn, Kbd } from '../ui'
import { ReportRowView } from './ReportRowView'
import { SortHeader } from './SortHeader'
import type { ReportRow, SortDir, SortField } from './types'
import { PAGE_SIZE } from './types'

interface Props {
  reports: ReportRow[]
  total: number
  page: number
  totalPages: number
  sort: SortField
  dir: SortDir
  selected: Set<string>
  cursor: number
  allSelected: boolean
  someSelected: boolean
  /** Set of report IDs currently being dispatched. Disables their inline
   *  Dispatch button while the queue request is in flight. */
  dispatching: Set<string>
  onToggleSelectAll: () => void
  onToggleSelect: (id: string) => void
  onSetSort: (f: SortField) => void
  onSetCursor: (i: number) => void
  onSetPage: (p: number) => void
  onOpen: (row: ReportRow) => void
  onCopyLink: (row: ReportRow) => void
  onDismiss: (row: ReportRow) => void
  onDispatchFix: (row: ReportRow) => void
}

export function ReportsTable({
  reports,
  total,
  page,
  totalPages,
  sort,
  dir,
  selected,
  cursor,
  allSelected,
  someSelected,
  dispatching,
  onToggleSelectAll,
  onToggleSelect,
  onSetSort,
  onSetCursor,
  onSetPage,
  onOpen,
  onCopyLink,
  onDismiss,
  onDispatchFix,
}: Props) {
  return (
    <div className="border border-edge-subtle rounded-md overflow-hidden bg-surface-raised/30">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Bug reports">
          <thead className="bg-surface-raised text-2xs uppercase tracking-wider text-fg-faint sticky top-0 z-10">
            <tr>
              <th scope="col" className="w-1 p-0" aria-label="Severity stripe" />
              <th scope="col" className="w-8 px-2 py-2 text-left pl-3">
                <input
                  type="checkbox"
                  aria-label={allSelected ? 'Deselect all on page' : 'Select all on page'}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected
                  }}
                  onChange={onToggleSelectAll}
                  className="h-3.5 w-3.5 accent-brand"
                />
              </th>
              {/* Summary text isn't a sortable field — the column shows the
                  free-form summary as primary content with component as a
                  secondary label. Use the Component filter chip to slice
                  by component instead. */}
              <th scope="col" className="px-2 py-2 font-medium text-left text-fg-faint">
                Summary
              </th>
              <SortHeader
                label="Status"
                field="status"
                current={sort}
                dir={dir}
                onSort={onSetSort}
                className="text-left w-28"
              />
              <SortHeader
                label="Severity"
                field="severity"
                current={sort}
                dir={dir}
                onSort={onSetSort}
                className="text-left w-24"
              />
              <SortHeader
                label="Conf."
                field="confidence"
                current={sort}
                dir={dir}
                onSort={onSetSort}
                className="text-right w-16"
              />
              <SortHeader
                label="Created"
                field="created_at"
                current={sort}
                dir={dir}
                onSort={onSetSort}
                className="text-right w-24"
              />
              <th scope="col" className="w-40 px-2 py-2 text-right">
                Next step
              </th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r, i) => (
              <ReportRowView
                key={r.id}
                row={r}
                index={i}
                isSelected={selected.has(r.id)}
                isCursor={i === cursor}
                dispatchBusy={dispatching.has(r.id)}
                onToggleSelect={() => onToggleSelect(r.id)}
                onFocus={() => onSetCursor(i)}
                onOpen={() => onOpen(r)}
                onCopyLink={() => onCopyLink(r)}
                onDismiss={() => onDismiss(r)}
                onDispatchFix={() => onDispatchFix(r)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-edge-subtle text-2xs text-fg-muted">
        <span>
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
        </span>
        <div className="flex items-center gap-1">
          <Btn variant="ghost" size="sm" disabled={page === 0} onClick={() => onSetPage(page - 1)}>
            <Kbd>[</Kbd> Prev
          </Btn>
          <span className="font-mono px-2">
            {page + 1} / {totalPages}
          </span>
          <Btn
            variant="ghost"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => onSetPage(page + 1)}
          >
            Next <Kbd>]</Kbd>
          </Btn>
        </div>
      </div>
    </div>
  )
}
