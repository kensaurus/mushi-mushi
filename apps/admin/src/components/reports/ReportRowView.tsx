/**
 * FILE: apps/admin/src/components/reports/ReportRowView.tsx
 * PURPOSE: Single triage-table row. Clicking the row navigates to the report
 *          detail view; explicit child controls (checkbox, actions, links)
 *          stop propagation so they fire without opening the report.
 */

import { Link } from 'react-router-dom'
import { Badge, Tooltip } from '../ui'
import { SEVERITY, STATUS, statusLabel } from '../../lib/tokens'
import { formatRelative, severityLabelShort, type ReportRow } from './types'

interface Props {
  row: ReportRow
  index: number
  isSelected: boolean
  isCursor: boolean
  onToggleSelect: () => void
  onFocus: () => void
  onOpen: () => void
  onCopyLink: () => void
  onDismiss: () => void
}

export function ReportRowView({
  row,
  index,
  isSelected,
  isCursor,
  onToggleSelect,
  onFocus,
  onOpen,
  onCopyLink,
  onDismiss,
}: Props) {
  const summary = row.summary ?? row.description
  const conf = row.confidence != null ? Math.round(row.confidence * 100) : null
  const baseRowCls =
    'group border-t border-edge-subtle hover:bg-surface-overlay/60 motion-safe:transition-colors cursor-pointer'
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
      <td className="px-2 py-2 align-top">
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
        <div className="text-sm text-fg-secondary line-clamp-2 leading-snug">{summary}</div>
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
      <td className="px-2 py-2 text-right align-top">
        <div className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 motion-safe:transition-opacity">
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
        <Link
          to={`/reports/${row.id}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-block text-2xs text-fg-muted hover:text-brand ml-1 group-hover:hidden"
        >
          Open →
        </Link>
      </td>
    </tr>
  )
}
