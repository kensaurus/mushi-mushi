/**
 * FILE: apps/admin/src/components/providers/HistoryPanel.tsx
 * PURPOSE: The History tab: route and account changes merged, newest first,
 *          as compact rows: when, who, what kind of change, what it touched,
 *          and before → after for the fields that changed. A run of adds or
 *          deletes by one actor (a migration adding nine routes) folds into
 *          one expandable row.
 */

import type { HistoryRow } from '../../lib/providersView'
import { ageLabel, groupHistory } from '../../lib/providersView'
import { Chip } from '../signal/Chip'

const OP_TONE: Record<HistoryRow['op'], string> = {
  INSERT: 'border-ok/50 bg-ok-muted text-ok-foreground',
  UPDATE: 'border-info/50 bg-info-muted text-info-foreground',
  DELETE: 'border-danger/50 bg-danger-muted text-danger-foreground',
}
const OP_WORD: Record<HistoryRow['op'], string> = { INSERT: 'added', UPDATE: 'changed', DELETE: 'deleted' }

function OpBadge({ op }: { op: HistoryRow['op'] }) {
  return <span className={`rounded-xs border px-1 text-3xs leading-4 font-bold whitespace-nowrap uppercase ${OP_TONE[op]}`}>{OP_WORD[op]}</span>
}

function When({ at, now }: { at: string; now: number }) {
  return (
    <span className="w-8 shrink-0 font-mono text-fg-secondary tabular-nums" title={at}>
      {ageLabel(at, now) ?? '—'}
    </span>
  )
}

/** before → after per field. An add has no before and a delete no after, so only the value that exists shows. */
function Diff({ row }: { row: HistoryRow }) {
  return (
    <span className="flex min-w-0 flex-wrap gap-x-2">
      {row.diff.map((d) => (
        <span key={d.field} className="inline-flex min-w-0 items-center gap-1 font-mono">
          <span className="text-fg-secondary">{d.field}</span>
          {row.op === 'INSERT' ? (
            <span className="truncate font-bold text-fg">{d.after}</span>
          ) : row.op === 'DELETE' ? (
            <span className="truncate text-fg-muted line-through decoration-1">{d.before}</span>
          ) : (
            <>
              <span className="truncate text-fg-muted line-through decoration-1" data-testid="hist-before">
                {d.before}
              </span>
              <span aria-hidden="true" className="text-fg-muted">
                →
              </span>
              <span className="sr-only">to</span>
              <span className="truncate font-bold text-fg">{d.after}</span>
            </>
          )}
        </span>
      ))}
    </span>
  )
}

function Row({ r, now }: { r: HistoryRow; now: number }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-surface px-2.5 py-1 text-2xs" data-testid={`history-${r.id}`}>
      <When at={r.at} now={now} />
      <span className="font-mono font-semibold text-fg">{r.actor}</span>
      <OpBadge op={r.op} />
      <Chip>{r.kind}</Chip>
      <span className="font-bold text-fg">{r.subject}</span>
      <Diff row={r} />
    </li>
  )
}

export function HistoryPanel({ rows, now }: { rows: readonly HistoryRow[]; now: number }) {
  if (rows.length === 0) return <p className="text-xs text-fg-muted">No changes yet.</p>
  const items = groupHistory(rows)
  return (
    <ul className="list-none divide-y divide-edge-subtle overflow-hidden rounded-md border border-edge p-0" aria-label="Changes, newest first" data-testid="providers-history">
      {items.map((it) =>
        it.type === 'row' ? (
          <Row key={it.row.id} r={it.row} now={now} />
        ) : (
          <li key={it.id} className="bg-surface text-2xs" data-testid={`history-${it.id}`}>
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 px-2.5 py-1 hover:bg-surface-hover">
                <When at={it.rows[0]!.at} now={now} />
                <span className="font-mono font-semibold text-fg">{it.actor}</span>
                <OpBadge op={it.op} />
                <span className="font-bold text-fg">
                  {it.rows.length} {it.kind === 'route' ? 'routes' : 'accounts'}
                </span>
              </summary>
              <ul className="list-none divide-y divide-edge-subtle border-t border-edge-subtle p-0">
                {it.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 pr-2.5 pl-12" data-testid={`history-${r.id}`}>
                    <span className="font-bold text-fg">{r.subject}</span>
                    <Diff row={r} />
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ),
      )}
    </ul>
  )
}
