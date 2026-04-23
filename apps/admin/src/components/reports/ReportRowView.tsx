/**
 * FILE: apps/admin/src/components/reports/ReportRowView.tsx
 * PURPOSE: Single triage-table row. The redesign turns the row into a
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

import { memo } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Tooltip } from '../ui'
import { SEVERITY } from '../../lib/tokens'
import { StatusStepper } from './StatusStepper'
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
  /** When >1, this row is the canonical (newest) of a fingerprint group with
   *  N siblings. Renders the expand chevron + "+N variants" chip. */
  variantCount?: number
  /** Whether the canonical row's siblings are currently expanded. */
  expanded?: boolean
  /** True when this row is rendered as a variant under an expanded canonical. */
  isVariant?: boolean
  /** Toggle expand state for this canonical row's group. Undefined for
   *  non-canonical / singleton rows. */
  onToggleGroup?: () => void
  onToggleSelect: () => void
  onFocus: () => void
  onOpen: () => void
  onCopyLink: () => void
  onDismiss: () => void
  onDispatchFix: () => void
}

function ReportRowViewInner({
  row,
  index,
  isSelected,
  isCursor,
  dispatchBusy = false,
  variantCount,
  expanded = false,
  isVariant = false,
  onToggleGroup,
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
  // Real blast radius — distinct people who felt this. Falls back to the raw
  // dedup count when the BE is older than the migration so the column
  // is never blank.
  const uniqueUsers = row.unique_users ?? 0
  const blastRadius = uniqueUsers > 0 ? uniqueUsers : dedupCount
  const canDispatch = DISPATCH_ELIGIBLE_STATUSES.has(row.status)

  // "Loud" rows = critical OR significant blast (>=3 distinct users felt it).
  // These get a slightly tinted background so triagers can scan the page and
  // see immediately where the real fires are without parsing severity badges.
  const isLoud = row.severity === 'critical' || blastRadius >= 3

  const baseRowCls =
    'group border-t border-edge-subtle hover:bg-surface-overlay/60 motion-safe:transition-colors cursor-pointer relative motion-safe:animate-mushi-fade-in'
  const cursorCls = isCursor ? 'bg-surface-overlay/40 outline outline-1 outline-brand/40' : ''
  const variantBgCls = isVariant ? 'bg-surface-overlay/30' : ''
  const selectedCls = isSelected ? 'bg-brand/5' : isLoud ? 'bg-danger/5' : variantBgCls
  // Stagger row entry by 18ms per index up to the first ~12 rows. Caps so a
  // 200-row page doesn't introduce a 4s wait on the last row; later rows just
  // share the final delay slot which still reads as "the table painted in".
  const staggerDelayMs = Math.min(index, 12) * 18

  return (
    <tr
      data-row-index={index}
      data-tour-id={index === 0 ? 'reports-row' : undefined}
      style={staggerDelayMs > 0 ? { animationDelay: `${staggerDelayMs}ms` } : undefined}
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
      <td className={`px-2 py-2 min-w-0 ${isVariant ? 'pl-7' : ''}`}>
        <div className="flex items-start gap-1.5 min-w-0">
          {onToggleGroup && (
            <Tooltip content={expanded ? 'Hide variants' : `Show ${(variantCount ?? 1) - 1} more variant${(variantCount ?? 1) - 1 === 1 ? '' : 's'}`}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleGroup()
                }}
                aria-expanded={expanded}
                aria-label={expanded ? 'Collapse variants' : 'Expand variants'}
                className="shrink-0 mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-sm text-fg-faint hover:text-fg hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className={`motion-safe:transition-transform ${expanded ? 'rotate-90' : ''}`}>
                  <path d="M3 2l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </Tooltip>
          )}
          {isVariant && (
            <span className="shrink-0 mt-0.5 text-2xs text-fg-faint" aria-hidden="true">↳</span>
          )}
          <div
            className="text-sm text-fg-secondary line-clamp-2 leading-snug min-w-0 flex-1"
            title={typeof summary === 'string' ? summary : undefined}
          >
            {summary}
          </div>
          {blastRadius > 1 && (
            <Tooltip
              content={
                uniqueUsers > 0
                  ? `${uniqueUsers} distinct user${uniqueUsers === 1 ? '' : 's'} felt this in the last 7d (across ${dedupCount} report${dedupCount === 1 ? '' : 's'}). One fix attempt closes the whole group — open to expand variants.`
                  : `Felt by ${dedupCount} report${dedupCount === 1 ? '' : 's'} so far. One fix attempt closes the whole group — open to see siblings.`
              }
            >
              <span
                className={`shrink-0 text-2xs font-mono px-1.5 py-0.5 rounded-full cursor-help border ${
                  blastRadius >= 5
                    ? 'bg-danger/15 text-danger border-danger/30'
                    : blastRadius >= 3
                      ? 'bg-warn/15 text-warn border-warn/30'
                      : 'bg-info-muted text-info border-info/20'
                }`}
              >
                ×{blastRadius} felt
              </span>
            </Tooltip>
          )}
          {variantCount && variantCount > 1 && !isVariant && (
            <Tooltip content={`${variantCount - 1} sibling report${variantCount - 1 === 1 ? '' : 's'} on this page share the same fingerprint. Click the chevron to expand.`}>
              <span className="shrink-0 text-2xs font-mono px-1.5 py-0.5 rounded-full border border-edge-subtle text-fg-muted cursor-help">
                +{variantCount - 1} variant{variantCount - 1 === 1 ? '' : 's'}
              </span>
            </Tooltip>
          )}
        </div>
        {row.component && (
          <div className="text-2xs text-fg-faint mt-0.5 font-mono truncate">{row.component}</div>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <StatusStepper
          status={row.status}
          severity={row.severity}
          timestamps={{ new: row.created_at }}
        />
      </td>
      <td className="px-2 py-2 align-top">
        {row.severity ? (
          <Badge
            className={SEVERITY[row.severity] ?? ''}
            title={`Severity: ${row.severity ?? 'unset'}`}
          >
            {severityLabelShort(row.severity)}
          </Badge>
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
                data-tour-id={index === 0 ? 'dispatch-fix-button' : undefined}
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

// Wave S3 (PERF): memoise so typing into the filter bar doesn't re-render
// every row in the list. ReportsTable renders up to 200 rows; each row
// re-render used to cost ~3 ms in a React 19 profiler — 600 ms per
// keystroke on a paginated table. Memo bails out when the callback
// identities are stable (ReportsTable already stabilises them via
// useCallback). Row data equality is shallow; ReportRow objects are
// replaced by new references only when the backend updates them.
export const ReportRowView = memo(ReportRowViewInner)
