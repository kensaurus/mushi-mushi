/**
 * Scannable fix attempts table with expandable detail rows.
 */

import { Fragment } from 'react'
import type { FixTimelineEvent } from '../FixGitGraph'
import { ResponsiveTable, TableDensityToggle } from '../ResponsiveTable'
import { FixRowView } from './FixRowView'
import { FixDetailPanel } from './FixDetailPanel'
import type { FixAttempt } from './types'
import { FIXES_STICKY_LEAD, FIXES_TABLE_COL, TABLE_CELL } from './fixesTableLayout'

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
  traceUrlFor: (traceId: string | null | undefined) => string | null
  inFlightReportIds: Set<string>
  inventoryActions: Record<string, InventoryActionNodeLike | null | undefined>
  onToggle: (fixId: string) => void
  onRetry: (reportId: string) => void
  onRefreshed?: () => void
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
  traceUrlFor,
  inFlightReportIds,
  inventoryActions,
  onToggle,
  onRetry,
  onRefreshed,
  compactTable = false,
  hideTableChrome = false,
  actionLabels,
}: Props) {
  return (
    <div className="border border-edge-subtle rounded-md overflow-hidden bg-surface-raised/30">
      {!hideTableChrome ? (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-edge-subtle bg-surface-raised/50">
          <span className="text-2xs text-fg-muted">
            {fixes.length} attempt{fixes.length === 1 ? '' : 's'} — expand a row for PDCA timeline & errors
          </span>
          <TableDensityToggle />
        </div>
      ) : (
        <div className="px-3 py-1.5 border-b border-edge-subtle bg-surface-raised/50">
          <span className="text-2xs text-fg-muted">
            {fixes.length} draft fix{fixes.length === 1 ? '' : 'es'} — tap a row for details
          </span>
        </div>
      )}
      <ResponsiveTable
        ariaLabel="Fix attempts"
        stickyLeadColumns={3}
        stickyOffsets={FIXES_STICKY_LEAD}
      >
        <table
          className={`w-full table-fixed border-collapse text-sm ${compactTable ? 'min-w-[44rem]' : 'min-w-[56rem]'}`}
          aria-label="Fix attempts"
        >
          <colgroup>
            <col className={FIXES_TABLE_COL.stripe} />
            <col className={FIXES_TABLE_COL.status} />
            <col className={FIXES_TABLE_COL.report} />
            {!compactTable ? <col className={FIXES_TABLE_COL.pipeline} /> : null}
            {!compactTable ? <col className={FIXES_TABLE_COL.ci} /> : null}
            <col className={FIXES_TABLE_COL.started} />
            <col className={FIXES_TABLE_COL.action} />
          </colgroup>
          <thead className="bg-surface-raised text-2xs uppercase tracking-wider text-fg-faint sticky top-0 z-10">
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
              <th scope="col" className={`${FIXES_TABLE_COL.started} ${TABLE_CELL.pxMeta} py-2 text-right font-medium`}>Started</th>
              <th scope="col" className={`${FIXES_TABLE_COL.action} ${TABLE_CELL.pxMeta} py-2 text-right font-medium`}>
                {actionLabels?.nextStepHeader ?? 'Actions'}
              </th>
            </tr>
          </thead>
          <tbody>
            {fixes.map((fix, idx) => {
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
                    compactTable={compactTable}
                    actionLabels={actionLabels}
                  />
                  {isExpanded && (
                    <tr>
                      <td colSpan={compactTable ? 5 : 7} className="p-0">
                        <FixDetailPanel
                          fix={fix}
                          timeline={timelines[fix.id]}
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
    </div>
  )
}
