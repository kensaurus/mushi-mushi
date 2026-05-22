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
import { Badge, Tooltip } from '../ui'
import { SEVERITY } from '../../lib/tokens'
import { ConfidenceMeter, SignalChip } from '../report-detail/ReportSurface'
import { useRowFlash } from '../../lib/useRowFlash'
import { StatusStepper } from './StatusStepper'
import { BreadcrumbPeek } from './BreadcrumbPeek'
import { IconBolt, IconShare, IconExternalLink, IconClose } from '../icons'
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
  /** When set, shows a "Send to Cursor agent" menu item in the row kebab. */
  onDispatchCursor?: () => void
  /** When set, shows "Send to Claude Code Agent" in the row kebab. */
  onDispatchClaude?: () => void
  /** Whether Cursor Cloud is configured for this project. */
  cursorEnabled?: boolean
  /** Whether Claude Code Agent is configured for this project. */
  claudeEnabled?: boolean
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
  onDispatchCursor,
  onDispatchClaude,
  cursorEnabled = false,
  claudeEnabled = false,
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
          <BreadcrumbPeek
            breadcrumbs={row.breadcrumbs}
            tags={row.tags}
            sentryRelease={row.sentry_release}
            sentryEnvironment={row.sentry_environment}
          >
            <div
              className="min-w-0 flex-1 rounded-sm border border-edge-subtle/55 bg-surface-overlay/25 px-2 py-1 text-sm leading-snug text-fg-secondary line-clamp-2"
              title={typeof summary === 'string' ? summary : undefined}
            >
              {summary}
            </div>
          </BreadcrumbPeek>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
          {blastRadius > 1 && (
            <Tooltip
              content={
                uniqueUsers > 0
                  ? `${uniqueUsers} distinct user${uniqueUsers === 1 ? '' : 's'} felt this in the last 7d (across ${dedupCount} report${dedupCount === 1 ? '' : 's'}). One fix attempt closes the whole group — open to expand variants.`
                  : `Felt by ${dedupCount} report${dedupCount === 1 ? '' : 's'} so far. One fix attempt closes the whole group — open to see siblings.`
              }
            >
              <SignalChip
                tone={blastRadius >= 5 ? 'danger' : blastRadius >= 3 ? 'warn' : 'info'}
                className="cursor-help font-mono"
              >
                ×{blastRadius} felt
              </SignalChip>
            </Tooltip>
          )}
          {reporterReplied && (
            <Tooltip content="Reporter replied after the last developer response. Open the report thread.">
              <SignalChip tone="accent" className="cursor-help">
                reporter replied
              </SignalChip>
            </Tooltip>
          )}
          {variantCount && variantCount > 1 && !isVariant && (
            <Tooltip content={`${variantCount - 1} sibling report${variantCount - 1 === 1 ? '' : 's'} on this page share the same fingerprint. Click the chevron to expand.`}>
              <SignalChip tone="neutral" className="cursor-help font-mono">
                +{variantCount - 1} variant{variantCount - 1 === 1 ? '' : 's'}
              </SignalChip>
            </Tooltip>
          )}
          </div>
        </div>
        {row.component && (
          <code className="mt-1 inline-flex max-w-full truncate rounded-sm border border-brand/20 bg-brand/8 px-1.5 py-0.5 font-mono text-2xs text-brand">
            {row.component}
          </code>
        )}
        {(hasObservability(row) || row.sentry_trace_id) && (
          <ObservabilityStrip row={row} />
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
        <ConfidenceMeter confidence={row.confidence} />
      </td>
      <td className="px-2 py-2 text-right align-top">
        <Tooltip content={new Date(row.created_at).toLocaleString()}>
          <span className="inline-flex cursor-help items-center rounded-sm border border-edge-subtle bg-surface-overlay/40 px-1.5 py-0.5 font-mono text-2xs tabular-nums text-fg-muted">
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
            onDispatchCursor={cursorEnabled && canDispatch ? onDispatchCursor : undefined}
            onDispatchClaude={claudeEnabled && canDispatch ? onDispatchClaude : undefined}
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
  onDispatchCursor?: () => void
  onDispatchClaude?: () => void
}

function RowKebab({ row, onCopyLink, onDismiss, onDispatchCursor, onDispatchClaude }: KebabProps) {
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
          <IconShare size={12} />
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
          <IconExternalLink size={12} />
        </a>
      </Tooltip>
      {onDispatchCursor && (
        <Tooltip content="Send to Cursor agent — dispatches a Cursor Cloud Agent to open a draft PR fixing this report">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDispatchCursor()
            }}
            className="p-1 text-[#a78bfa] hover:text-[#c4b5fd] hover:bg-[#7c3aed]/10 rounded-sm"
            aria-label="Send to Cursor agent"
          >
            {/* Cursor diamond icon */}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <polygon points="6,1 11,6 6,11 1,6" />
            </svg>
          </button>
        </Tooltip>
      )}
      {onDispatchClaude && (
        <Tooltip content="Send to Claude Code Agent — triggers your repo's mushi-claude-fix workflow (BYOK)">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDispatchClaude()
            }}
            className="p-1 text-[#d97706] hover:text-[#f59e0b] hover:bg-[#d97706]/10 rounded-sm"
            aria-label="Send to Claude Code Agent"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <circle cx="6" cy="6" r="4.5" />
            </svg>
          </button>
        </Tooltip>
      )}
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
          <IconClose size={12} />
        </button>
      </Tooltip>
    </div>
  )
}

/**
 * Tiny inline strip beneath the row's component line that surfaces
 * a single representative tag and a Sentry-trace pill when present.
 * Deliberately kept to one line so it doesn't grow row height; the
 * BreadcrumbPeek hover-card is the affordance for the full set.
 *
 * "Most informative tag" wins the inline slot. We pick by precedence:
 * `feature` → `flag` → `tenant` → `plan` → first key alphabetically.
 */
const INLINE_TAG_PRIORITY = ['feature', 'flag', 'tenant', 'plan', 'env', 'release']

function pickInlineTag(
  tags: Record<string, string | number | boolean> | null | undefined,
): [string, string | number | boolean] | null {
  if (!tags) return null
  const keys = Object.keys(tags)
  if (keys.length === 0) return null
  for (const k of INLINE_TAG_PRIORITY) {
    if (k in tags) return [k, tags[k]]
  }
  const [first] = keys.sort()
  return [first, tags[first]]
}

function hasObservability(row: ReportRow): boolean {
  return Boolean(
    (row.tags && Object.keys(row.tags).length > 0) ||
      row.sentry_release ||
      row.sentry_environment,
  )
}

function ObservabilityStrip({ row }: { row: ReportRow }) {
  const inlineTag = pickInlineTag(row.tags)
  const tagCount = row.tags ? Object.keys(row.tags).length : 0
  const traceShort = row.sentry_trace_id
    ? `${row.sentry_trace_id.slice(0, 7)}…`
    : null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 rounded-sm border border-edge-subtle/45 bg-surface-overlay/20 px-1.5 py-1">
      {inlineTag && (
        <span
          className="inline-flex max-w-[14rem] items-center truncate rounded-sm border border-edge-subtle bg-surface-overlay/50 px-1.5 py-0.5 font-mono text-2xs text-fg-secondary"
          title={`Tag — ${inlineTag[0]}: ${String(inlineTag[1])}`}
        >
          <span className="text-fg-muted">{inlineTag[0]}</span>
          <span className="mx-0.5 text-fg-faint">:</span>
          <span className="truncate">{String(inlineTag[1])}</span>
        </span>
      )}
      {tagCount > 1 && (
        <SignalChip tone="neutral" className="font-mono">
          +{tagCount - 1} tags
        </SignalChip>
      )}
      {traceShort && (
        <Tooltip content={`Sentry trace: ${row.sentry_trace_id}`}>
          <SignalChip tone="brand" className="cursor-help font-mono">
            <IconBolt className="size-2.5" />
            {traceShort}
          </SignalChip>
        </Tooltip>
      )}
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
