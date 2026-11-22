/**
 * FILE: apps/admin/src/components/signal/HeatGrid.tsx
 * PURPOSE: Rows × columns of graded cells with a legend (2026-11-18, from the CI page's week
 *          heatmap and job-times heat cells). One table answers "which row is worst, and on
 *          what" at a glance: each column has a scale and every cell is coloured on it, with
 *          the number inside.
 *
 * Scales:
 *  - `heat`  teal, darker = more (volume, time) — neutral, not good or bad.
 *  - `bad`   red, darker = worse (open bugs, failures, days stale). Zero is plain.
 *  - `state` a status per cell: danger ▲ / warn ◆ / ok ● / info ■ / off ○, tint + glyph + text.
 *
 * It renders a real <table> (caption, column headers, row headers), so a screen reader gets the
 * text equivalent for free; each cell also carries a title. Rows can carry highlight keys
 * (components/signal/linkedHighlight) so pointing at a row lights the same thing elsewhere.
 * The grid scrolls sideways inside its own box on a narrow screen, never the page.
 */

import type { ReactNode } from 'react'
import { useLinked, type HighlightKey } from './linkedHighlight'
import { badnessClass, heatClass } from './scale'
import { StatusGlyph, TONE_CHAR, type SignalTone } from './StatusGlyph'

type HeatScaleKind = 'heat' | 'bad' | 'state'

export interface HeatColumn {
  id: string
  /** Header text (short: "Open bugs", "SDK behind"). */
  label: string
  scale: HeatScaleKind
  /** Top of the colour scale; defaults to the column's largest value. */
  max?: number
  /** Header tooltip: what the column counts. */
  hint?: string
}

export interface HeatCellValue {
  /** The number the colour is computed from; null = no data (hatched). */
  value: number | null
  /** What to print in the cell; defaults to the value. */
  display?: ReactNode
  /** For `state` columns: the cell's status. */
  tone?: SignalTone
  /** Tooltip / plain-text description of the cell. */
  title?: string
}

export interface HeatRow {
  id: string
  label: ReactNode
  /** A second, lighter line under the label. */
  sub?: ReactNode
  /** Keys this row belongs to; the first is what pointing at it lights. */
  keys?: HighlightKey[]
  cells: Record<string, HeatCellValue | undefined>
  /** Clicking the row label goes here (rendered by the caller via `renderLabel`). */
}

const STATE_CELL: Record<SignalTone, string> = {
  danger: 'bg-danger-muted text-danger-foreground',
  warn: 'bg-warn-muted text-warn-foreground',
  ok: 'bg-ok-muted text-ok-foreground',
  info: 'bg-info-muted text-info-foreground',
  off: 'bg-surface-overlay text-fg-secondary',
}

const LEGEND_HEAT = ['ci-heat-1', 'ci-heat-2', 'ci-heat-3', 'ci-heat-4', 'ci-heat-5', 'ci-heat-6']
const LEGEND_BAD = ['ci-fail-1', 'ci-fail-2', 'ci-fail-3', 'ci-fail-4', 'ci-fail-5']

/** The colour class of one cell (exported for tests). */
export function heatCellClass(col: HeatColumn, cell: HeatCellValue | undefined, colMax: number): string {
  if (!cell || cell.value == null) {
    if (col.scale === 'state' && cell?.tone) return STATE_CELL[cell.tone]
    return 'ci-nodata'
  }
  if (col.scale === 'state') return STATE_CELL[cell.tone ?? 'off']
  if (col.scale === 'bad') return badnessClass(cell.value, colMax)
  return heatClass(cell.value, colMax)
}

/** The largest value in a column (or its fixed max). */
export function columnMax(col: HeatColumn, rows: readonly HeatRow[]): number {
  if (col.max != null) return col.max
  let max = 0
  for (const r of rows) max = Math.max(max, r.cells[col.id]?.value ?? 0)
  return max
}

function Row({
  row,
  columns,
  maxes,
  index,
  renderLabel,
}: {
  row: HeatRow
  columns: readonly HeatColumn[]
  maxes: number[]
  index: number
  renderLabel?: (row: HeatRow) => ReactNode
}) {
  const keys = row.keys ?? []
  const link = useLinked(keys, keys[0] ?? row.id, keys.length > 0)
  return (
    <tr {...link} className={`${link.className} ci-rise ${keys.length > 0 ? 'cursor-pointer' : ''}`} style={{ animationDelay: `${index * 30}ms` }} data-testid={`heat-row-${row.id}`}>
      <th scope="row" className="max-w-56 py-0.5 pr-2 text-left align-middle font-normal">
        <span className="block truncate text-xs font-bold text-fg">{renderLabel ? renderLabel(row) : row.label}</span>
        {row.sub && <span className="block truncate text-3xs text-fg-secondary">{row.sub}</span>}
      </th>
      {columns.map((col, ci) => {
        const cell = row.cells[col.id]
        const cls = heatCellClass(col, cell, maxes[ci] ?? 0)
        const shown = cell?.display ?? (cell?.value == null ? '–' : String(cell.value))
        return (
          <td key={col.id} className="p-0.5 align-middle">
            <span
              className={`sig-cell ci-pop flex h-6 min-w-12 items-center justify-center gap-1 rounded-xs px-1 font-mono text-2xs font-bold tabular-nums ${cls}`}
              style={{ animationDelay: `${index * 30 + ci * 15}ms` }}
              title={cell?.title ?? `${col.label}: ${typeof shown === 'string' ? shown : (cell?.value ?? 'no data')}`}
              data-col={col.id}
            >
              {col.scale === 'state' && cell?.tone && <StatusGlyph tone={cell.tone} className="h-2.5 w-2.5" />}
              {shown}
            </span>
          </td>
        )
      })}
    </tr>
  )
}

export function HeatGrid({
  caption,
  columns,
  rows,
  renderLabel,
  rowHeader = 'App',
  legend = true,
  testId = 'heat-grid',
  className = '',
}: {
  /** Names the table (visible as a small heading). */
  caption: string
  columns: readonly HeatColumn[]
  /** Already sorted (worst first is the convention). */
  rows: readonly HeatRow[]
  renderLabel?: (row: HeatRow) => ReactNode
  rowHeader?: string
  legend?: boolean
  testId?: string
  className?: string
}) {
  const maxes = columns.map((c) => columnMax(c, rows))
  const scales = new Set(columns.map((c) => c.scale))
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`} data-testid={testId}>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full border-separate border-spacing-0">
          <caption className="pb-1 text-left text-3xs font-bold tracking-wider text-fg uppercase">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-2 pb-1 text-left text-2xs font-semibold text-fg-secondary">
                {rowHeader}
              </th>
              {columns.map((c) => (
                <th key={c.id} scope="col" className="px-0.5 pb-1 text-center text-2xs leading-tight font-semibold text-fg-secondary" title={c.hint}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Row key={r.id} row={r} columns={columns} maxes={maxes} index={i} renderLabel={renderLabel} />
            ))}
          </tbody>
        </table>
      </div>
      {legend && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-3xs text-fg-secondary" data-testid={`${testId}-legend`}>
          {scales.has('bad') && (
            <span className="inline-flex items-center gap-0.5">
              <span className="mr-1">fewer</span>
              {LEGEND_BAD.map((c) => (
                <span key={c} className={`h-2 w-3 rounded-xs ${c}`} aria-hidden="true" />
              ))}
              <span className="ml-1">worse</span>
            </span>
          )}
          {scales.has('heat') && (
            <span className="inline-flex items-center gap-0.5">
              <span className="mr-1">less</span>
              {LEGEND_HEAT.map((c) => (
                <span key={c} className={`h-2 w-3 rounded-xs ${c}`} aria-hidden="true" />
              ))}
              <span className="ml-1">more</span>
            </span>
          )}
          {scales.has('state') && (
            <span>
              {TONE_CHAR.danger} needs you · {TONE_CHAR.warn} watch · {TONE_CHAR.ok} fine · {TONE_CHAR.off} not set up
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <span className="ci-nodata inline-block h-2 w-3 rounded-xs border border-edge-subtle" aria-hidden="true" /> no data
          </span>
        </p>
      )}
    </div>
  )
}
