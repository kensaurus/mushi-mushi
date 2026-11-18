/**
 * FILE: apps/admin/src/components/reports/ReportsTable.tsx
 * PURPOSE: Sortable, paginated triage table. Owns the table chrome (header,
 *          pagination footer) and renders each row via ReportRowView.
 *          All mutations bubble back to the page through callbacks.
 *
 *          Group collapse: when `groupBy === 'fingerprint'`, rows sharing a
 *          report_group_id (or one check's headline across apps) collapse
 *          under a single canonical row with a "+N similar" chip + expand
 *          chevron (reportDisplayRows.ts). Singletons render unchanged.
 *          Expand state lives in URL params so the back-button restores it.
 */

import { useMemo } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { Btn, Kbd } from '../ui'
import { ResponsiveTable } from '../ResponsiveTable'
import { ReportRowView } from './ReportRowView'
import { ReportRowCard } from './ReportRowCard'
import { SortHeader } from './SortHeader'
import type { ReportRow, SortDir, SortField } from './types'
import { PAGE_SIZE } from './types'
import type { PreflightState } from '../../lib/useDispatchPreflight'
import { preflightForReportRow } from './allAppsRowActions'
import { buildDisplayRows, type DisplayRow } from './reportDisplayRows'
import { REPORTS_TABLE_COL, REPORTS_STICKY_LEAD, REPORTS_TABLE_MIN_W, TABLE_CELL } from './reportsTableLayout'

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
  /** Shared dispatch preflight state. Threaded down to every row's
   *  DispatchFixPreflight popover so prerequisites are visible BEFORE the
   *  user clicks Queue (and we never round-trip the 4-check fetch per row). */
  preflight?: PreflightState
  /**
   * All apps: the preflight was loaded for this app only. Rows from other
   * apps get an explanation instead of that checklist. Null in one-app mode.
   */
  preflightProjectId?: string | null
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
  preflight,
  preflightProjectId = null,
}: Props) {
  const [tbodyParent] = useAutoAnimate({
    duration: 220,
    easing: 'ease-out',
  })

  // Group-collapse: rows of one fingerprint (and a check filed in several
  // apps) collapse behind their first row (reportDisplayRows.ts).
  const displayRows: DisplayRow[] = useMemo(
    () => buildDisplayRows(reports, groupCollapse, expandedGroups),
    [reports, groupCollapse, expandedGroups],
  )

  const visibleGroupCount = useMemo(
    () => displayRows.filter((d) => !d.isVariantOf).length,
    [displayRows],
  )

  return (
    <div className="border border-edge-subtle rounded-md overflow-hidden bg-surface-raised">
      <div className="px-3 py-1.5 border-b border-edge-subtle bg-surface-raised">
        <span className="block text-2xs text-fg-muted min-w-0 truncate">
          {total.toLocaleString('en-US')} report{total === 1 ? '' : 's'} — click a row to triage<span className="hidden sm:inline">; scroll for status & actions</span>
        </span>
      </div>
      {/* Phone: stacked rows with status and severity inline; the table
          scrolled sideways and hid them (fresh-eyes sweep 2026-11-18). */}
      <ul className="divide-y divide-edge-subtle sm:hidden" aria-label="Bug reports" data-testid="reports-card-list">
        {displayRows.map((d) => {
          const rowPreflight = preflightForReportRow(preflight, preflightProjectId, d.row)
          return (
            <ReportRowCard
              key={d.row.id}
              row={d.row}
              isSelected={selected.has(d.row.id)}
              dispatchBusy={dispatching.has(d.row.id)}
              variantCount={d.variantCount}
              appCount={d.appCount}
              onToggleSelect={() => onToggleSelect(d.row.id)}
              onOpen={() => onOpen(d.row)}
              onDispatchFix={() => onDispatchFix(d.row)}
              preflight={rowPreflight.preflight}
              dispatchScopeNote={rowPreflight.dispatchScopeNote}
            />
          )
        })}
      </ul>
      <div className="hidden sm:block">
      <ResponsiveTable
        ariaLabel="Bug reports"
        stickyLeadColumns={3}
        stickyOffsets={REPORTS_STICKY_LEAD}
      >
        <table
          className={`reports-triage-table w-full ${REPORTS_TABLE_MIN_W} table-fixed border-collapse text-sm`}
          aria-label="Bug reports"
        >
          <colgroup>
            <col className={REPORTS_TABLE_COL.stripe} />
            <col className={REPORTS_TABLE_COL.checkbox} />
            <col className={REPORTS_TABLE_COL.summary} />
            <col className={REPORTS_TABLE_COL.status} />
            <col className={REPORTS_TABLE_COL.severity} />
            <col className={REPORTS_TABLE_COL.confidence} />
            <col className={REPORTS_TABLE_COL.action} />
          </colgroup>
          <thead className="bg-surface-raised text-2xs text-fg-secondary sticky top-0 z-10 font-semibold">
            <tr>
              <th scope="col" className={`${REPORTS_TABLE_COL.stripe} p-0`} aria-label="Severity stripe" />
              <th scope="col" className={`${REPORTS_TABLE_COL.checkbox} ${TABLE_CELL.pxLead} py-2 text-left pl-3`}>
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
              <th scope="col" className={`${REPORTS_TABLE_COL.summary} ${TABLE_CELL.pxLead} py-2 font-medium text-left text-fg-faint`}>
                Summary
              </th>
              <SortHeader
                label="Status"
                field="status"
                current={sort}
                dir={dir}
                onSort={onSetSort}
                align="center"
                cellPx={TABLE_CELL.pxMeta}
                className={REPORTS_TABLE_COL.status}
              />
              <SortHeader
                label="Severity"
                field="severity"
                current={sort}
                dir={dir}
                onSort={onSetSort}
                align="center"
                cellPx={TABLE_CELL.pxMeta}
                className={REPORTS_TABLE_COL.severity}
              />
              <SortHeader
                label="Conf."
                fullLabel="Confidence: how sure Mushi Mushi is about the severity and category"
                field="confidence"
                current={sort}
                dir={dir}
                onSort={onSetSort}
                align="center"
                cellPx={TABLE_CELL.pxMeta}
                className={REPORTS_TABLE_COL.confidence}
              />
              <SortHeader
                label="Action · age"
                fullLabel="Action, and how long ago it came in (sort by age)"
                field="created_at"
                current={sort}
                dir={dir}
                onSort={onSetSort}
                align="right"
                cellPx={TABLE_CELL.pxMeta}
                className={REPORTS_TABLE_COL.action}
              />
            </tr>
          </thead>
          <tbody ref={tbodyParent}>
            {displayRows.map((d, i) => {
              const rowPreflight = preflightForReportRow(preflight, preflightProjectId, d.row)
              return (
              <ReportRowView
                key={d.row.id}
                row={d.row}
                index={i}
                isSelected={selected.has(d.row.id)}
                isCursor={i === cursor}
                dispatchBusy={dispatching.has(d.row.id)}
                variantCount={d.variantCount}
                appCount={d.appCount}
                expanded={d.expanded}
                isVariant={Boolean(d.isVariantOf)}
                onToggleGroup={
                  d.groupKey && d.variantCount && d.variantCount > 1
                    ? () => onToggleGroup(d.groupKey as string)
                    : undefined
                }
                onToggleSelect={() => onToggleSelect(d.row.id)}
                onFocus={() => onSetCursor(i)}
                onOpen={() => onOpen(d.row)}
                onCopyLink={() => onCopyLink(d.row)}
                onDismiss={() => onDismiss(d.row)}
                onDispatchFix={() => onDispatchFix(d.row)}
                preflight={rowPreflight.preflight}
                dispatchScopeNote={rowPreflight.dispatchScopeNote}
              />
              )
            })}
          </tbody>
        </table>
      </ResponsiveTable>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-edge-subtle text-2xs text-fg-muted">
        <span className="min-w-0">
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString('en-US')}
          {groupCollapse && visibleGroupCount !== reports.length && (
            <span className="ml-2 text-fg-faint">· grouped into {visibleGroupCount} fingerprint{visibleGroupCount === 1 ? '' : 's'}</span>
          )}
        </span>
        {/* The pager stays on one line: "1 / 43" wrapped to three at 390px. */}
        <div className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap" data-testid="reports-pager">
          <Btn variant="ghost" size="sm" disabled={page === 0} onClick={() => onSetPage(page - 1)}>
            <Kbd>[</Kbd> Prev
          </Btn>
          <span className="whitespace-nowrap font-mono px-2">
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
