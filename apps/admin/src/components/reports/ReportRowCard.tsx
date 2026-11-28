/**
 * FILE: apps/admin/src/components/reports/ReportRowCard.tsx
 * PURPOSE: One report as a stacked row on a phone. The triage table scrolled
 *          sideways at 390px: titles were cut and Status, Severity, Conf. and
 *          the action sat off-screen (fresh-eyes sweep 2026-11-18). The card
 *          keeps the same parts in reading order: where it came from and the
 *          title, the app line, then status, severity, age and the one action.
 *
 *          No outer card: rows are list items divided by a rule inside the
 *          table's frame, with the same severity stripe on the left edge.
 *
 *          Touch (console UX pass 2026-11-22): the checkbox and the row's one
 *          action are 44px targets, and the action sits on its own line with
 *          the age and a low-confidence chip, so the status line keeps its
 *          words ("Classified", "2 of 4").
 */

import { memo } from 'react'
import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { StatusStepper } from './StatusStepper'
import { ReportRowMeta } from './ReportRowSummaryMeta'
import { ReportSourceTag } from './ReportSourceTag'
import { DispatchFixPreflight } from './DispatchFixPreflight'
import { LowConfidenceChip, TableSeverityCell } from './ReportMetricCells'
import { closedRowAction } from './reportRowAction'
import { reportRowIntent } from '../../lib/actionIntent'
import { variantChip } from './reportDisplayRows'
import { DISPATCH_ELIGIBLE_STATUSES, formatRelative, severityStripeClass, type ReportRow } from './types'
import { reportSourceKind, showsSeverity } from '../../lib/reportSourceKind'
import { reportDetailPath } from '../../lib/reportUrl'
import { reportHeadline } from '../../lib/format'
import { useActiveProjectId } from '../ProjectSwitcher'
import type { PreflightState } from '../../lib/useDispatchPreflight'

interface Props {
  row: ReportRow
  isSelected: boolean
  dispatchBusy?: boolean
  /** Siblings sharing the fingerprint (canonical row only). */
  variantCount?: number
  /** Apps the group spans (canonical rows only). */
  appCount?: number
  onToggleSelect: () => void
  onOpen: () => void
  onDispatchFix: () => void
  preflight?: PreflightState
  dispatchScopeNote?: string | null
}

function ReportRowCardInner({ row, isSelected, dispatchBusy = false, variantCount, appCount = 1, onToggleSelect, onOpen, onDispatchFix, preflight, dispatchScopeNote = null }: Props) {
  const activeProjectId = useActiveProjectId()
  const detailPath = reportDetailPath(row.id, activeProjectId)
  const rawTitle = row.title ?? row.summary ?? row.description
  const title = typeof rawTitle === 'string' ? reportHeadline(rawTitle) : 'Untitled report'
  const blastRadius = Math.max(row.unique_users ?? 0, row.dedup_count ?? 1)
  const canDispatch = DISPATCH_ELIGIBLE_STATUSES.has(row.status)
  const closedAction = closedRowAction(row.status)

  return (
    <li
      className="relative cursor-pointer py-2 pl-3 pr-2 hover:bg-surface-overlay/60"
      data-testid={`report-card-${row.id}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input, a, label')) return
        onOpen()
      }}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${severityStripeClass(row.severity)}`} />
      <div className="flex min-w-0 items-start gap-2">
        {/* A 44px tap area around the small box; the row opens on any other tap. */}
        <label className="-my-2.5 -ml-3 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            aria-label={isSelected ? 'Deselect report' : 'Select report'}
            className="h-4 w-4 accent-brand"
          />
        </label>
        <div className="min-w-0 flex-1 space-y-1">
          {/* Three lines on a phone: two cut titles mid-phrase ("projects-to-…",
              "relationship wa…", round-3 sweep 2026-11-19). */}
          <Link to={detailPath} className="line-clamp-3 text-sm font-medium leading-snug text-fg hover:underline" title={title}>
            <ReportSourceTag report={row} className="mr-1.5 align-middle" />
            {title}
            {variantCount && variantCount > 1 ? (
              <span className="ml-1 whitespace-nowrap text-2xs font-normal text-fg-muted" title={variantChip(variantCount, appCount).tooltip}>
                {variantChip(variantCount, appCount).label}
              </span>
            ) : null}
          </Link>
          <ReportRowMeta row={row} />
          <div className="flex min-w-0 items-end gap-2">
            <div className="min-w-0 flex-1">
              <StatusStepper size="table" status={row.status} severity={row.severity} className="w-full" />
            </div>
            <div className="w-16 shrink-0">
              <TableSeverityCell severity={showsSeverity(reportSourceKind(row)) ? row.severity : null} />
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 whitespace-nowrap text-2xs tabular-nums text-fg-muted">{formatRelative(row.created_at)}</span>
            <LowConfidenceChip confidence={row.confidence} />
            <span className="ml-auto inline-flex shrink-0">
              {canDispatch ? (
                <DispatchFixPreflight
                  variant="card"
                  busy={dispatchBusy}
                  severity={row.severity}
                  blastRadius={blastRadius}
                  confidence={row.confidence}
                  onConfirm={onDispatchFix}
                  blockReason={dispatchScopeNote ?? row.dispatch_block ?? null}
                  onOpenDetail={onOpen}
                  preflight={dispatchScopeNote ? undefined : preflight}
                  repoUrl={dispatchScopeNote ? null : (preflight?.repoUrl ?? null)}
                />
              ) : (
                <Btn
                  to={detailPath}
                  intent={reportRowIntent(row.status)}
                  onClick={(e) => e.stopPropagation()}
                  className="min-h-11 whitespace-nowrap"
                >
                  {closedAction ? closedAction.label : 'Triage →'}
                </Btn>
              )}
            </span>
          </div>
        </div>
      </div>
    </li>
  )
}

export const ReportRowCard = memo(ReportRowCardInner)
