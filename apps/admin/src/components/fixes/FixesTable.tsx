/**
 * Scannable fix attempts table with expandable detail rows.
 */

import { Fragment } from 'react'
import type { FixTimelineEvent } from '../FixGitGraph'
import { ResponsiveTable, TableDensityToggle } from '../ResponsiveTable'
import { FixRowView } from './FixRowView'
import { FixDetailPanel } from './FixDetailPanel'
import type { FixAttempt } from './types'

interface InventoryActionSummary {
  actionNodeId: string
  actionLabel: string
  actionDescription?: string | null
  pagePath?: string | null
  storyTitle?: string | null
  expectedOutcome?: Record<string, unknown> | null
  status?: string | null
}

interface Props {
  fixes: FixAttempt[]
  expandedId: string | null
  timelines: Record<string, FixTimelineEvent[]>
  traceUrlFor: (traceId: string | null | undefined) => string | null
  inFlightReportIds: Set<string>
  inventoryActions: Record<string, InventoryActionSummary | null | undefined>
  onToggle: (fixId: string) => void
  onRetry: (reportId: string) => void
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
      <ResponsiveTable stickyFirstColumn ariaLabel="Fix attempts">
        <table className="w-full text-sm">
          <thead className="bg-surface-raised text-2xs uppercase tracking-wider text-fg-faint sticky top-0 z-10">
            <tr>
              <th scope="col" className="w-1 p-0" aria-label="Status stripe" />
              <th scope="col" className="px-2 py-2 text-left font-medium w-28">Status</th>
              <th scope="col" className="px-2 py-2 text-left font-medium">Report</th>
              {!compactTable ? (
                <th scope="col" className="px-2 py-2 text-left font-medium w-32">Pipeline</th>
              ) : null}
              {!compactTable ? (
                <th scope="col" className="px-2 py-2 text-left font-medium hidden md:table-cell">CI / Agent</th>
              ) : null}
              <th scope="col" className="px-2 py-2 text-right font-medium w-24">Started</th>
              <th scope="col" className="px-2 py-2 text-right font-medium w-36">
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
                        actionNodeId: rawInv.actionNodeId,
                        actionLabel: rawInv.actionLabel,
                        actionDescription: rawInv.actionDescription,
                        pagePath: rawInv.pagePath,
                        storyTitle: rawInv.storyTitle,
                        expectedOutcome: rawInv.expectedOutcome,
                        status: rawInv.status,
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
