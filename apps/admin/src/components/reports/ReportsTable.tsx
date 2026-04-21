/**
 * FILE: apps/admin/src/components/reports/ReportsTable.tsx
 * PURPOSE: Sortable, paginated triage table. Owns the table chrome (header,
 *          pagination footer) and renders each row via ReportRowView.
 *          All mutations bubble back to the page through callbacks.
 *
 *          Group collapse: when `groupBy === 'fingerprint'`, rows sharing a
 *          report_group_id are collapsed under a single canonical row with a
 *          "+N variants" chip + expand chevron. Singletons render unchanged.
 *          Expand state lives in URL params so the back-button restores it.
 */

import { useMemo } from 'react'
import { Btn, Kbd } from '../ui'
import { ResponsiveTable } from '../ResponsiveTable'
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
  /** When true, sibling rows sharing a fingerprint collapse under a single
   *  canonical row. */
  groupCollapse: boolean
  /** Set of report_group_id strings whose siblings are currently expanded. */
  expandedGroups: Set<string>
  onToggleGroup: (groupId: string) => void
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

interface DisplayRow {
  row: ReportRow
  /** Total siblings in this group, including the canonical (>=1). Only set
   *  for canonical rows when group-collapse is on. */
  variantCount?: number
  /** Whether this canonical row's siblings are currently expanded. */
  expanded?: boolean
  /** True when this row is a sibling rendered under an expanded canonical. */
  isVariantOf?: string
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
  groupCollapse,
  expandedGroups,
  onToggleGroup,
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
  // Build the display list: when group-collapse is on, sibling rows that
  // share a report_group_id collapse behind their canonical (newest) row.
  // Singletons are unaffected. We preserve the BE-supplied sort by walking
  // the array in order and only emitting the *first* row of each group.
  const displayRows: DisplayRow[] = useMemo(() => {
    if (!groupCollapse) return reports.map((r) => ({ row: r }))

    const seen = new Set<string>()
    const groupMembers = new Map<string, ReportRow[]>()
    for (const r of reports) {
      const gid = r.report_group_id
      if (!gid) continue
      const arr = groupMembers.get(gid) ?? []
      arr.push(r)
      groupMembers.set(gid, arr)
    }

    const out: DisplayRow[] = []
    for (const r of reports) {
      const gid = r.report_group_id
      if (!gid) {
        out.push({ row: r })
        continue
      }
      if (seen.has(gid)) continue
      seen.add(gid)
      const members = groupMembers.get(gid) ?? [r]
      const variantCount = members.length
      const expanded = expandedGroups.has(gid)
      out.push({ row: r, variantCount, expanded })
      if (expanded && members.length > 1) {
        for (const sib of members.slice(1)) {
          out.push({ row: sib, isVariantOf: gid })
        }
      }
    }
    return out
  }, [reports, groupCollapse, expandedGroups])

  const visibleGroupCount = useMemo(
    () => displayRows.filter((d) => !d.isVariantOf).length,
    [displayRows],
  )

  return (
    <div className="border border-edge-subtle rounded-md overflow-hidden bg-surface-raised/30">
      <ResponsiveTable stickyFirstColumn ariaLabel="Bug reports">
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
                fullLabel="Confidence"
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
            {displayRows.map((d, i) => (
              <ReportRowView
                key={d.row.id}
                row={d.row}
                index={i}
                isSelected={selected.has(d.row.id)}
                isCursor={i === cursor}
                dispatchBusy={dispatching.has(d.row.id)}
                variantCount={d.variantCount}
                expanded={d.expanded}
                isVariant={Boolean(d.isVariantOf)}
                onToggleGroup={
                  d.row.report_group_id && d.variantCount && d.variantCount > 1
                    ? () => onToggleGroup(d.row.report_group_id as string)
                    : undefined
                }
                onToggleSelect={() => onToggleSelect(d.row.id)}
                onFocus={() => onSetCursor(i)}
                onOpen={() => onOpen(d.row)}
                onCopyLink={() => onCopyLink(d.row)}
                onDismiss={() => onDismiss(d.row)}
                onDispatchFix={() => onDispatchFix(d.row)}
              />
            ))}
          </tbody>
        </table>
      </ResponsiveTable>

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-edge-subtle text-2xs text-fg-muted">
        <span>
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          {groupCollapse && visibleGroupCount !== reports.length && (
            <span className="ml-2 text-fg-faint">· grouped into {visibleGroupCount} fingerprint{visibleGroupCount === 1 ? '' : 's'}</span>
          )}
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
