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

import { memo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Tooltip } from '../ui'
import { useRowFlash } from '../../lib/useRowFlash'
import { StatusStepper } from './StatusStepper'
import { BreadcrumbPeek } from './BreadcrumbPeek'
import { ReportRowMeta, ReportRowLayerPill } from './ReportRowSummaryMeta'
import { DispatchFixPreflight } from './DispatchFixPreflight'
import type { PreflightState } from '../../lib/useDispatchPreflight'
import { IconShare, IconExternalLink, IconClose } from '../icons'
import {
  DISPATCH_ELIGIBLE_STATUSES,
  formatRelative,
  severityStripeClass,
  type ReportRow,
} from './types'
import {
  REPORTS_ACTION_STACK_MAX,
  REPORTS_TABLE_COL,
  TABLE_CELL,
} from './reportsTableLayout'
import {
  BlastRadiusMeter,
  RecencyHeatLabel,
  TableConfidenceCell,
  TableSeverityCell,
} from './ReportMetricCells'

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
  /** Dispatch readiness for the active project, fetched once at the page
   *  level and shared across every row's preflight popover. */
  preflight?: PreflightState
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
  preflight,
}: Props) {
  const summary = row.summary ?? row.description
  const dedupCount = row.dedup_count ?? 1
  // Real blast radius — distinct people who felt this. Falls back to the raw
  // dedup count when the BE is older than the migration so the column
  // is never blank.
  const uniqueUsers = row.unique_users ?? 0
  const blastRadius = uniqueUsers > 0 ? uniqueUsers : dedupCount
  const canDispatch = DISPATCH_ELIGIBLE_STATUSES.has(row.status)
  const reporterReplied = Boolean(
    row.last_reporter_reply_at
      && (!row.last_admin_reply_at || new Date(row.last_reporter_reply_at) > new Date(row.last_admin_reply_at)),
  )

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

  // Wave T.2.5 single-shot background wash when a realtime update flips
  // the status — e.g. triager sees the row go `new → classified` in place.
  // We key the flash on `status|severity` so either transition fires the
  // animation; tone tracks whichever value changed most recently.
  const flashStatusTone = useCallback((s: ReportRow['status']) => {
    switch (s) {
      case 'fixed':
        return 'var(--color-ok)'
      case 'fixing':
      case 'classified':
      case 'queued':
      case 'grouped':
        return 'var(--color-info)'
      case 'dismissed':
        return 'var(--color-fg-muted)'
      default:
        return 'var(--color-brand)'
    }
  }, [])
  const statusFlash = useRowFlash({
    rowKey: row.id,
    value: row.status,
    toneFor: flashStatusTone,
  })

  return (
    <tr
      data-row-index={index}
      data-tour-id={index === 0 ? 'reports-row' : undefined}
      style={{
        ...(staggerDelayMs > 0 ? { animationDelay: `${staggerDelayMs}ms` } : undefined),
        ...statusFlash.style,
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input, a')) return
        onOpen()
      }}
      onMouseEnter={onFocus}
      onAnimationEnd={statusFlash.onAnimationEnd}
      className={`${baseRowCls} ${cursorCls} ${selectedCls} ${statusFlash.className}`}
    >
      <td className={`${REPORTS_TABLE_COL.stripe} p-0 align-stretch`}>
        {/* Severity stripe — uses a ::before-style absolute fill so it spans
            the full row height regardless of summary line-clamp wrap. */}
        <div
          className={`absolute inset-y-0 left-0 w-1 ${severityStripeClass(row.severity)}`}
          aria-hidden="true"
        />
      </td>
      <td className={`${REPORTS_TABLE_COL.checkbox} ${TABLE_CELL.pxLead} py-2 align-top pl-3`}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          aria-label={isSelected ? 'Deselect report' : 'Select report'}
          className="h-3.5 w-3.5 accent-brand"
        />
      </td>
      <td className={`${REPORTS_TABLE_COL.summary} ${TABLE_CELL.pxLead} py-2 align-top min-w-0 overflow-hidden ${isVariant ? 'pl-7' : ''}`}>
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-start gap-1 min-w-0">
            {onToggleGroup && (
              <Tooltip portal content={expanded ? 'Hide variants' : `Show ${(variantCount ?? 1) - 1} more variant${(variantCount ?? 1) - 1 === 1 ? '' : 's'}`}>
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
            <BreadcrumbPeek
              breadcrumbs={row.breadcrumbs}
              tags={row.tags}
              sentryRelease={row.sentry_release}
              sentryEnvironment={row.sentry_environment}
            >
              <div
                className="w-full min-w-0 flex-1 truncate text-sm leading-snug text-fg-secondary"
                title={typeof summary === 'string' ? summary : undefined}
              >
                {summary}
              </div>
            </BreadcrumbPeek>
            <div className="shrink-0 flex items-center gap-1 pt-px">
              {blastRadius > 1 && (
                <BlastRadiusMeter
                  value={blastRadius}
                  tooltip={
                    uniqueUsers > 0
                      ? `${uniqueUsers} distinct user${uniqueUsers === 1 ? '' : 's'} felt this (across ${dedupCount} reports).`
                      : `Felt by ${dedupCount} reports.`
                  }
                />
              )}
              {reporterReplied && (
                <Tooltip portal content="Reporter replied — open thread">
                  <span className="shrink-0 rounded-full border border-accent/35 bg-accent-muted/70 px-1.5 py-0.5 text-2xs font-medium text-[var(--color-accent-foreground)] cursor-help">
                    reply
                  </span>
                </Tooltip>
              )}
              {variantCount && variantCount > 1 && !isVariant && (
                <Tooltip portal content={`${variantCount - 1} sibling reports share this fingerprint`}>
                  <span className="shrink-0 rounded-full border border-edge-subtle px-1.5 py-0.5 text-2xs font-mono text-fg-muted cursor-help">
                    +{variantCount - 1}
                  </span>
                </Tooltip>
              )}
              <ReportRowLayerPill row={row} />
            </div>
          </div>
          <ReportRowMeta row={row} />
        </div>
      </td>
      <td className={`reports-metric-cell ${REPORTS_TABLE_COL.status} ${TABLE_CELL.pxMeta}`}>
        <div className="reports-metric-cell-slot">
          <StatusStepper
            className="w-full min-w-0 max-w-full"
            size="table"
            status={row.status}
            severity={row.severity}
            timestamps={{ new: row.created_at }}
          />
        </div>
      </td>
      <td className={`reports-metric-cell ${REPORTS_TABLE_COL.severity} ${TABLE_CELL.pxMeta}`}>
        <div className="reports-metric-cell-slot">
          <TableSeverityCell severity={row.severity} />
        </div>
      </td>
      <td className={`reports-metric-cell reports-metric-cell--confidence ${REPORTS_TABLE_COL.confidence} ${TABLE_CELL.pxMeta}`}>
        <div className="reports-metric-cell-slot reports-metric-cell-slot--confidence">
          <TableConfidenceCell confidence={row.confidence} layout="table" />
        </div>
      </td>
      <td className={`reports-action-cell ${REPORTS_TABLE_COL.action} ${TABLE_CELL.pxMeta}`}>
        <div className={`reports-action-stack ${REPORTS_ACTION_STACK_MAX} ml-auto w-full min-w-0`}>
          <div className="reports-action-top ml-auto w-full min-w-0">
            <span className="row-kebab-reveal pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto inline-flex shrink-0 items-center gap-0">
              <RowKebab row={row} onCopyLink={onCopyLink} onDismiss={onDismiss} />
            </span>
            {canDispatch ? (
              <span
                className="inline-flex shrink-0 min-w-0"
                data-tour-id={index === 0 ? 'dispatch-fix-button' : undefined}
              >
                <DispatchFixPreflight
                  variant="table"
                  busy={dispatchBusy}
                  severity={row.severity}
                  blastRadius={blastRadius}
                  confidence={row.confidence}
                  onConfirm={onDispatchFix}
                  onOpenDetail={onOpen}
                  preflight={preflight}
                  repoUrl={preflight?.repoUrl ?? null}
                />
              </span>
            ) : (
              <Link
                to={`/reports/${row.id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex h-5 shrink-0 items-center justify-center truncate px-1.5 text-3xs font-medium leading-none rounded-sm bg-brand text-brand-fg hover:bg-brand-hover"
              >
                Triage →
              </Link>
            )}
          </div>
          <div className="reports-action-age">
            <RecencyHeatLabel
              createdAt={row.created_at}
              label={formatRelative(row.created_at)}
              compact
              wrapperClass="w-full"
            />
          </div>
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
    <>
      <Tooltip portal content="Copy share link">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCopyLink()
          }}
          className="p-1 text-fg-faint hover:text-fg-muted hover:bg-surface-overlay rounded-sm"
          aria-label="Copy link"
        >
          <IconShare size={12} />
        </button>
      </Tooltip>
      <Tooltip portal content="Open in new tab">
        <a
          href={`/reports/${row.id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-1 text-fg-faint hover:text-fg-muted hover:bg-surface-overlay rounded-sm inline-flex"
          aria-label="Open in new tab"
        >
          <IconExternalLink size={12} />
        </a>
      </Tooltip>
      <Tooltip portal content="Dismiss">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
          className="p-1 text-fg-faint hover:text-danger hover:bg-danger-muted/20 rounded-sm"
          aria-label="Dismiss"
        >
          <IconClose size={12} />
        </button>
      </Tooltip>
    </>
  )
}

export const ReportRowView = memo(ReportRowViewInner)
