/**
 * FILE: apps/admin/src/components/providers/HistoryPanel.tsx
 * PURPOSE: The History tab: route and account changes merged, newest first,
 *          as compact rows: when, who, what kind of change, what it touched,
 *          and before → after for the fields that changed.
 */

import type { HistoryRow } from '../../lib/providersView'
import { ageLabel } from '../../lib/providersView'
import { Chip } from './providerMarks'

const OP_TONE: Record<HistoryRow['op'], string> = {
  INSERT: 'border-ok/50 bg-ok-muted text-ok-foreground',
  UPDATE: 'border-info/50 bg-info-muted text-info-foreground',
  DELETE: 'border-danger/50 bg-danger-muted text-danger-foreground',
}
const OP_WORD: Record<HistoryRow['op'], string> = { INSERT: 'added', UPDATE: 'changed', DELETE: 'deleted' }

export function HistoryPanel({ rows, now }: { rows: readonly HistoryRow[]; now: number }) {
  if (rows.length === 0) return <p className="text-xs text-fg-muted">No changes yet.</p>
  return (
    <ul className="list-none divide-y divide-edge-subtle overflow-hidden rounded-md border border-edge p-0" aria-label="Changes, newest first" data-testid="providers-history">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-surface px-2.5 py-1 text-2xs" data-testid={`history-${r.id}`}>
          <span className="w-8 shrink-0 font-mono text-fg-secondary tabular-nums" title={r.at}>
            {ageLabel(r.at, now) ?? '—'}
          </span>
          <span className="font-mono font-semibold text-fg">{r.actor}</span>
          <span className={`rounded-xs border px-1 text-3xs leading-4 font-bold uppercase ${OP_TONE[r.op]}`}>{OP_WORD[r.op]}</span>
          <Chip>{r.kind}</Chip>
          <span className="font-bold text-fg">{r.subject}</span>
          <span className="flex min-w-0 flex-wrap gap-x-2">
            {r.diff.map((d) => (
              <span key={d.field} className="inline-flex min-w-0 items-center gap-1 font-mono">
                <span className="text-fg-secondary">{d.field}</span>
                <span className="truncate text-danger-foreground line-through decoration-1">{d.before}</span>
                <span aria-hidden="true" className="text-fg-muted">
                  →
                </span>
                <span className="sr-only">to</span>
                <span className="truncate font-bold text-ok-foreground">{d.after}</span>
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}
