import { RelativeTime } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'
import type { HistoryRow, TeamRow } from './types'

export type { HistoryRow, TeamRow }

// One row of the user's saved/recent history list. The pin + delete buttons
// are touch-visible at narrow viewports (≤ pointer:coarse) and hover-revealed
// on desktop — `focus-within` keeps them keyboard-reachable too.
export function HistoryItem({
  row,
  onRerun,
  onToggleSave,
  onDelete,
}: {
  row: HistoryRow
  onRerun: () => void
  onToggleSave: () => void
  onDelete: () => void
}) {
  return (
    <li className="rounded-sm border border-edge-subtle p-2 hover:bg-surface-overlay/30 motion-safe:transition-colors group focus-within:border-edge">
      <button
        type="button"
        onClick={onRerun}
        className="text-left w-full text-2xs text-fg-secondary hover:text-fg"
        title={row.error ?? 'Click to rerun'}
      >
        <span className="inline-flex items-center gap-1.5 w-full min-w-0">
          {row.mode === 'raw' && (
            <span className={`inline-flex shrink-0 px-1 py-0.5 rounded-[2px] text-2xs font-mono font-medium ${CHIP_TONE.warnSubtle} border border-warn/20`}>SQL</span>
          )}
          <span className="line-clamp-2">{row.prompt}</span>
        </span>
      </button>
      <div className="flex items-center justify-between mt-1 text-2xs text-fg-faint font-mono gap-1">
        <span className="truncate">
          <RelativeTime value={row.created_at} />
          {row.error ? (
            <span className="ml-1 text-danger">· error</span>
          ) : (
            <span className="ml-1">
              · {row.row_count} row{row.row_count === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleSave}
            className={`motion-safe:transition-opacity hover:text-brand ${
              row.is_saved ? 'text-brand' : 'opacity-60 group-hover:opacity-100 group-focus-within:opacity-100'
            }`}
            aria-label={row.is_saved ? 'Unpin saved query' : 'Pin to Saved'}
            title={row.is_saved ? 'Unpin saved query' : 'Pin to Saved'}
          >
            {row.is_saved ? '★' : '☆'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 motion-safe:transition-opacity hover:text-danger"
            aria-label="Delete history entry"
          >
            ✕
          </button>
        </span>
      </div>
    </li>
  )
}

// Teammate-saved query row. Shows the author's display name as the primary
// attribution chip — without that the Team tab would be indistinguishable
// from "Saved" except for "wait, why does it have a different prompt?".
export function TeamItem({ row, onRerun }: { row: TeamRow; onRerun: () => void }) {
  const display = row.author_name ?? row.author_email ?? 'Teammate'
  const initial = (row.author_name ?? row.author_email ?? '?').charAt(0).toUpperCase()
  return (
    <li className="rounded-sm border border-edge-subtle p-2 hover:bg-surface-overlay/30 motion-safe:transition-colors group">
      <button
        type="button"
        onClick={onRerun}
        className="text-left w-full text-2xs text-fg-secondary hover:text-fg"
        title={`Run this query (saved by ${display})`}
      >
        <span className="line-clamp-2">{row.prompt}</span>
      </button>
      <div className="flex items-center justify-between mt-1.5 text-2xs gap-1">
        <span className="flex items-center gap-1 min-w-0">
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand/15 text-brand font-medium text-2xs shrink-0"
            aria-hidden="true"
          >
            {initial}
          </span>
          <span className="text-fg-secondary truncate" title={row.author_email ?? undefined}>
            {display}
          </span>
        </span>
        <span className="text-fg-faint font-mono shrink-0">
          <RelativeTime value={row.created_at} />
        </span>
      </div>
    </li>
  )
}
