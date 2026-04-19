/**
 * FILE: apps/admin/src/components/reports/ReportRowView.tsx
 * PURPOSE: Single triage-table row. Wave-3 redesign turns the row into a
 *          decision surface: a severity stripe on the left for instant scan,
 *          a "+N similar" dedup badge inline with the summary, and a primary
 *          `Triage →` (or `Dispatch fix →` once classified) call-to-action so
 *          users always know the next move per row.
 *
 *          Clicking anywhere outside an interactive control still opens the
 *          report — we just give the next-best action a real button instead
 *          of relying on tiny opacity-on-hover icons that no first-time user
 *          would discover.
 */

import { Link } from 'react-router-dom'
import { Badge, Tooltip } from '../ui'
import { SEVERITY, STATUS, statusLabel } from '../../lib/tokens'
import {
  DISPATCH_ELIGIBLE_STATUSES,
  formatRelative,
  severityLabelShort,
  severityStripeClass,
  type ReportRow,
} from './types'

interface Props {
  row: ReportRow
  index: number
  isSelected: boolean
  isCursor: boolean
  dispatchBusy?: boolean
  onToggleSelect: () => void
  onFocus: () => void
  onOpen: () => void
  onCopyLink: () => void
  onDismiss: () => void
  onDispatchFix: () => void
}

export function ReportRowView({
  row,
  index,
  isSelected,
  isCursor,
  dispatchBusy = false,
  onToggleSelect,
  onFocus,
  onOpen,
  onCopyLink,
  onDismiss,
  onDispatchFix,
}: Props) {
  const summary = row.summary ?? row.description
  const conf = row.confidence != null ? Math.round(row.confidence * 100) : null
  const dedupCount = row.dedup_count ?? 1
  const canDispatch = DISPATCH_ELIGIBLE_STATUSES.has(row.status)

  const baseRowCls =
    'group border-t border-edge-subtle hover:bg-surface-overlay/60 motion-safe:transition-colors cursor-pointer relative'
  const cursorCls = isCursor ? 'bg-surface-overlay/40 outline outline-1 outline-brand/40' : ''
  const selectedCls = isSelected ? 'bg-brand/5' : ''

  return (
    <tr
      data-row-index={index}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input, a')) return
        onOpen()
      }}
      onMouseEnter={onFocus}
      className={`${baseRowCls} ${cursorCls} ${selectedCls}`}
    >
      <td className="w-1 p-0 align-stretch">
        {/* Severity stripe — uses a ::before-style absolute fill so it spans
            the full row height regardless of summary line-clamp wrap. */}
        <div
          className={`absolute inset-y-0 left-0 w-1 ${severityStripeClass(row.severity)}`}
          aria-hidden="true"
        />
      </td>
      <td className="px-2 py-2 align-top pl-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          aria-label={isSelected ? 'Deselect report' : 'Select report'}
          className="h-3.5 w-3.5 accent-brand"
        />
      </td>
      <td className="px-2 py-2 min-w-0">
        <div className="flex items-start gap-1.5 min-w-0">
          <div className="text-sm text-fg-secondary line-clamp-2 leading-snug min-w-0 flex-1">
            {summary}
          </div>
          {dedupCount > 1 && (
            <Tooltip content={`${dedupCount} reports grouped by similarity. Open to see siblings.`}>
              <span className="shrink-0 text-2xs font-mono px-1.5 py-0.5 rounded-full bg-info-muted text-info border border-info/20 cursor-help">
                +{dedupCount - 1} similar
              </span>
            </Tooltip>
          )}
        </div>
        {row.component && (
          <div className="text-2xs text-fg-faint mt-0.5 font-mono truncate">{row.component}</div>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <Badge className={STATUS[row.status] ?? 'text-fg-muted border border-edge'}>
          {statusLabel(row.status)}
        </Badge>
      </td>
      <td className="px-2 py-2 align-top">
        {row.severity ? (
          <Badge className={SEVERITY[row.severity] ?? ''}>{severityLabelShort(row.severity)}</Badge>
        ) : (
          <span className="text-2xs text-fg-faint">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-right align-top">
        {conf != null ? (
          <span className="text-xs font-mono text-fg-muted">{conf}%</span>
        ) : (
          <span className="text-2xs text-fg-faint">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-right align-top">
        <Tooltip content={new Date(row.created_at).toLocaleString()}>
          <span className="text-2xs text-fg-faint font-mono cursor-help">
            {formatRelative(row.created_at)}
          </span>
        </Tooltip>
      </td>
      <td className="px-2 py-2 text-right align-top whitespace-nowrap">
        <div className="inline-flex items-center gap-1">
          {canDispatch ? (
            <Tooltip content="Dispatch an agentic fix attempt for this report (creates a draft PR).">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDispatchFix()
                }}
                disabled={dispatchBusy}
                className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded-sm bg-brand/10 text-brand border border-brand/30 hover:bg-brand/20 disabled:opacity-50 disabled:cursor-wait"
              >
                {dispatchBusy ? 'Dispatching…' : 'Dispatch fix →'}
              </button>
            </Tooltip>
          ) : (
            <Link
              to={`/reports/${row.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2 py-1 text-2xs font-medium rounded-sm bg-brand text-brand-fg hover:bg-brand-hover"
            >
              Triage →
            </Link>
          )}
          <RowKebab
            row={row}
            onCopyLink={onCopyLink}
            onDismiss={onDismiss}
          />
        </div>
      </td>
    </tr>
  )
}

interface KebabProps {
  row: ReportRow
  onCopyLink: () => void
  onDismiss: () => void
}

function RowKebab({ row, onCopyLink, onDismiss }: KebabProps) {
  return (
    <div className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 motion-safe:transition-opacity">
      <Tooltip content="Copy share link">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCopyLink()
          }}
          className="p-1 text-fg-faint hover:text-fg-muted hover:bg-surface-overlay rounded-sm"
          aria-label="Copy link"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 7l4-4M13 7V3h-4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7 9l-4 4M3 9v4h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip content="Open in new tab">
        <a
          href={`/reports/${row.id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-1 text-fg-faint hover:text-fg-muted hover:bg-surface-overlay rounded-sm inline-flex"
          aria-label="Open in new tab"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 2h4v4M14 2L7 9M11 8v5H3V5h5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </Tooltip>
      <Tooltip content="Dismiss">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
          className="p-1 text-fg-faint hover:text-danger hover:bg-danger-muted/20 rounded-sm"
          aria-label="Dismiss"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="4" y1="4" x2="12" y2="12" strokeLinecap="round" />
            <line x1="12" y1="4" x2="4" y2="12" strokeLinecap="round" />
          </svg>
        </button>
      </Tooltip>
    </div>
  )
}
