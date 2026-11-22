/**
 * Scannable fix attempts table with expandable detail rows.
 *
 * Progressive rows (console polish 2026-11-22): /fixes loads up to 200 attempts per request,
 * and drawing all 200 rows at once made the page slow to open and long to scroll. The table
 * draws the first `FIXES_FIRST_ROWS` and adds that many more per "Show more"; "Show all" draws
 * the rest. A row opened by a deep link is always drawn, however far down it sits.
 */

import { Fragment, useState } from 'react'
import type { FixTimelineEvent } from '../FixGitGraph'
import { ResponsiveTable } from '../ResponsiveTable'
import { FixRowView } from './FixRowView'
import { FixDetailPanel } from './FixDetailPanel'
import type { FixAttempt } from './types'
import { pluralizeWithCount } from '../../lib/format'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { FIXES_STICKY_LEAD, FIXES_TABLE_COL, TABLE_CELL } from './fixesTableLayout'
import { Btn } from '../ui'

/** Rows drawn first, and added per "Show more". */
const FIXES_FIRST_ROWS = 50

/**
 * How many rows to draw: the requested count, stretched to include the expanded row.
 *
 * @internal Exported for tests.
 */
export function fixRowsToDraw(total: number, requested: number, expandedIndex: number): number {
  return Math.min(total, Math.max(requested, expandedIndex + 1))
}

interface InventoryActionNodeLike {
  actionNodeId?: string
  id?: string
  actionLabel?: string
  label?: string
  actionDescription?: string | null
  pagePath?: string | null
  storyTitle?: string | null
  expectedOutcome?: Record<string, unknown> | null
  status?: string | null
  metadata?: Record<string, unknown>
}

interface Props {
  fixes: FixAttempt[]
  expandedId: string | null
  timelines: Record<string, FixTimelineEvent[]>
  /** Per-fix `base_branch` from the timeline endpoint. */
  baseBranches?: Record<string, string | null>
  traceUrlFor: (traceId: string | null | undefined) => string | null
  inFlightReportIds: Set<string>
  inventoryActions: Record<string, InventoryActionNodeLike | null | undefined>
  onToggle: (fixId: string) => void
  onRetry: (reportId: string) => void
  onRefreshed?: () => void
  /** Bulk selection by row (console QA 92). */
  selectedIds?: ReadonlySet<string>
  onSelectFix?: (fixId: string, selected: boolean) => void
  /** True while a bulk merge/retry runs: selection is frozen until it ends. */
  selectionDisabled?: boolean
  compactTable?: boolean
  hideTableChrome?: boolean
  actionLabels?: {
    openPr?: string
    retry?: string
    nextStepHeader?: string
    expand?: string
    collapse?: string
  }
}

export function FixesTable({
  fixes,
  expandedId,
  timelines,
  baseBranches,
  traceUrlFor,
  inFlightReportIds,
  inventoryActions,
  onToggle,
  onRetry,
  onRefreshed,
  selectedIds,
  onSelectFix,
  selectionDisabled = false,
  compactTable = false,
  hideTableChrome = false,
  actionLabels,
}: Props) {
  // Phones: the 44rem table hid Started and the actions off to the side and
  // cut the state pill and the summary (2026-11-22 design pass). Below `sm`
  // the time moves under the agent, the summary wraps, and the row fits.
  const phone = useMediaQuery('(max-width: 639.98px)')
  const columnCount = (compactTable ? 5 : 7) - (phone ? 1 : 0)
  const [requested, setRequested] = useState(FIXES_FIRST_ROWS)
  const drawn = fixRowsToDraw(fixes.length, requested, expandedId ? fixes.findIndex((f) => f.id === expandedId) : -1)
  const notShown = fixes.length - drawn
  return (
    <div className="border border-edge-subtle rounded-md overflow-hidden bg-surface-raised/30">
      {!hideTableChrome ? (
        <div className="px-3 py-1.5 border-b border-edge-subtle bg-surface-raised/50">
          <span className="text-2xs text-fg-muted">
            {fixes.length} attempt{fixes.length === 1 ? '' : 's'} — expand a row for PDCA timeline & errors
          </span>
        </div>
      ) : (
        <div className="px-3 py-1.5 border-b border-edge-subtle bg-surface-raised/50">
          <span className="text-2xs text-fg-muted">
            {pluralizeWithCount(fixes.length, 'fix', 'fixes')} — tap a row for details
          </span>
        </div>
      )}
      <ResponsiveTable
        ariaLabel="Fix attempts"
        stickyLeadColumns={3}
        stickyOffsets={FIXES_STICKY_LEAD}
      >
        <table
          className={`w-full table-fixed border-collapse text-sm ${phone ? '' : compactTable ? 'min-w-[44rem]' : 'min-w-[56rem]'}`}
          aria-label="Fix attempts"
        >
          <colgroup>
            <col className={FIXES_TABLE_COL.stripe} />
            <col className={FIXES_TABLE_COL.status} />
            <col className={phone ? undefined : FIXES_TABLE_COL.report} />
            {!compactTable ? <col className={FIXES_TABLE_COL.pipeline} /> : null}
            {!compactTable ? <col className={FIXES_TABLE_COL.ci} /> : null}
            {!phone ? <col className={FIXES_TABLE_COL.started} /> : null}
            <col className={FIXES_TABLE_COL.action} />
          </colgroup>
          <thead className="bg-surface-raised text-2xs text-fg-secondary sticky top-0 z-10 font-semibold">
            <tr>
              <th scope="col" className={`${FIXES_TABLE_COL.stripe} p-0`} aria-label="Status stripe" />
              <th scope="col" className={`${FIXES_TABLE_COL.status} ${TABLE_CELL.pxMeta} py-2 text-left font-medium`}>Status</th>
              <th scope="col" className={`${FIXES_TABLE_COL.report} ${TABLE_CELL.pxLead} py-2 text-left font-medium`}>Report</th>
              {!compactTable ? (
                <th scope="col" className={`${FIXES_TABLE_COL.pipeline} ${TABLE_CELL.pxMeta} py-2 text-left font-medium`}>Pipeline</th>
              ) : null}
              {!compactTable ? (
                <th scope="col" className={`${FIXES_TABLE_COL.ci} ${TABLE_CELL.pxMeta} py-2 text-left font-medium hidden md:table-cell`}>CI / Agent</th>
              ) : null}
              {!phone ? (
                <th scope="col" className={`${FIXES_TABLE_COL.started} ${TABLE_CELL.pxMeta} py-2 text-right font-medium`}>Started</th>
              ) : null}
              <th scope="col" className={`${FIXES_TABLE_COL.action} ${TABLE_CELL.pxMeta} py-2 text-right font-medium`}>
                {actionLabels?.nextStepHeader ?? 'Actions'}
              </th>
            </tr>
          </thead>
          <tbody>
            {fixes.slice(0, drawn).map((fix, idx) => {
              const isExpanded = expandedId === fix.id
              const nodeId = fix.inventory_action_node_id
              const rawInv = nodeId ? inventoryActions[nodeId] : undefined
              const inventoryAction =
                rawInv === undefined
                  ? undefined
                  : rawInv
                    ? {
                        actionNodeId: (rawInv.actionNodeId ?? rawInv.id ?? nodeId ?? 'unknown') as string,
                        actionLabel: (rawInv.actionLabel ?? rawInv.label ?? 'Unknown action') as string,
                        actionDescription: rawInv.actionDescription ?? (rawInv.metadata?.['action'] as string | null) ?? null,
                        pagePath: rawInv.pagePath ?? (rawInv.metadata?.['page_path'] as string | null) ?? null,
                        storyTitle: rawInv.storyTitle ?? (rawInv.metadata?.['story_title'] as string | null) ?? null,
                        expectedOutcome: (rawInv.expectedOutcome ?? (rawInv.metadata?.['expected_outcome'] as Record<string, unknown> | null) ?? null),
                        status: rawInv.status ?? (rawInv.metadata?.['status'] as string | null) ?? null,
                      }
                    : null

              return (
                <Fragment key={fix.id}>
                  <FixRowView
                    fix={fix}
                    index={idx}
                    isExpanded={isExpanded}
                    isInFlight={inFlightReportIds.has(fix.report_id)}
                    onToggle={() => onToggle(fix.id)}
                    onRetry={() => onRetry(fix.report_id)}
                    selected={selectedIds?.has(fix.id) ?? false}
                    onSelectChange={onSelectFix ? (on) => onSelectFix(fix.id, on) : undefined}
                    selectionDisabled={selectionDisabled}
                    compactTable={compactTable}
                    phone={phone}
                    actionLabels={actionLabels}
                  />
                  {isExpanded && (
                    <tr>
                      <td colSpan={columnCount} className="p-0">
                        <FixDetailPanel
                          fix={fix}
                          timeline={timelines[fix.id]}
                          baseBranch={baseBranches?.[fix.id]}
                          traceUrl={traceUrlFor(fix.langfuse_trace_id)}
                          onRetry={() => Promise.resolve(onRetry(fix.report_id))}
                          onRefreshed={onRefreshed}
                          isInFlight={inFlightReportIds.has(fix.report_id)}
                          inventoryAction={inventoryAction}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </ResponsiveTable>
      {notShown > 0 ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-t border-edge-subtle px-3 py-1.5 text-2xs text-fg-muted"
          data-testid="fixes-table-more"
        >
          <span>
            Showing {drawn} of {pluralizeWithCount(fixes.length, 'attempt')}.
          </span>
          <span className="flex items-center gap-1">
            <Btn size="sm" variant="ghost" className="pointer-coarse:min-h-11" onClick={() => setRequested(drawn + FIXES_FIRST_ROWS)}>
              Show {Math.min(FIXES_FIRST_ROWS, notShown)} more
            </Btn>
            {notShown > FIXES_FIRST_ROWS ? (
              <Btn size="sm" variant="ghost" className="pointer-coarse:min-h-11" onClick={() => setRequested(fixes.length)}>
                Show all {fixes.length}
              </Btn>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  )
}
