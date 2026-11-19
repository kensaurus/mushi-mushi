/**
 * FILE: apps/admin/src/components/providers/HistoryPanel.tsx
 * PURPOSE: The History tab: route and account changes merged, newest first,
 *          as compact rows: when, who, what kind of change, what it touched,
 *          and before → after for the fields that changed. A run of adds or
 *          deletes by one actor (a migration adding nine routes) folds into
 *          one expandable row.
 */

import type { HistoryRow } from '../../lib/providersView'
import { ageLabel, groupHistory, plainChanges } from '../../lib/providersView'
import { Chip } from '../signal/Chip'


const OP_WORD: Record<HistoryRow['op'], string> = { INSERT: 'added', UPDATE: 'changed', DELETE: 'deleted' }

/**
 * Added and deleted say so as a plain verb; a change is the default and says itself in its words
 * (2026-11-18: "CHANGED" ×6; round 3: one uppercase "ADDED" pill on one row read as an alarm).
 */
function OpBadge({ op }: { op: HistoryRow['op'] }) {
  if (op === 'UPDATE') return null
  return <span className="whitespace-nowrap text-fg-secondary" data-op={op}>{OP_WORD[op]}</span>
}

function When({ at, now }: { at: string; now: number }) {
  return (
    <span className="w-8 shrink-0 font-mono text-fg-secondary tabular-nums" title={at}>
      {ageLabel(at, now) ?? '—'}
    </span>
  )
}

/** What changed, in plain words (plainChanges); wraps instead of cutting off at 390. */
function Changes({ changes }: { changes: readonly string[] }) {
  return (
    <span className="flex min-w-0 flex-wrap gap-x-2" data-testid="hist-changes">
      {changes.map((c) => (
        <span key={c} className="min-w-0 wrap-anywhere text-fg-secondary">
          {c}
        </span>
      ))}
    </span>
  )
}

function Row({ r, now, showKind }: { r: HistoryRow; now: number; showKind: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-surface px-2.5 py-1 text-2xs" data-testid={`history-${r.id}`}>
      <When at={r.at} now={now} />
      <span className="font-mono font-semibold text-fg">{r.actor}</span>
      <OpBadge op={r.op} />
      {showKind && <Chip>{r.kind}</Chip>}
      <span className="font-bold text-fg">{r.subject}</span>
      <Changes changes={plainChanges(r)} />
    </li>
  )
}

export function HistoryPanel({ rows, now }: { rows: readonly HistoryRow[]; now: number }) {
  if (rows.length === 0) return <p className="text-xs text-fg-muted">No changes yet.</p>
  const items = groupHistory(rows)
  // "route" on every row said nothing: the kind chip shows only when routes and accounts mix.
  const showKind = new Set(rows.map((r) => r.kind)).size > 1
  return (
    <ul className="list-none divide-y divide-edge-subtle overflow-hidden rounded-md border border-edge p-0" aria-label="Changes, newest first" data-testid="providers-history">
      {items.map((it) =>
        it.type === 'row' ? (
          <Row key={it.row.id} r={it.row} now={now} showKind={showKind} />
        ) : it.type === 'same' ? (
          <li key={it.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-surface px-2.5 py-1 text-2xs" data-testid={`history-${it.id}`}>
            <When at={it.rows[0]!.at} now={now} />
            <span className="font-mono font-semibold text-fg">{it.actor}</span>
            <Changes changes={it.changes} />
            <span className="text-fg-muted">on</span>
            <span className="flex min-w-0 flex-wrap gap-x-1.5 font-bold text-fg">
              {it.rows.map((r, n) => (
                <span key={r.id} data-testid={`history-${r.id}`}>
                  {r.subject}
                  {n < it.rows.length - 1 ? ',' : ''}
                </span>
              ))}
            </span>
          </li>
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
                    <Changes changes={plainChanges(r)} />
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
