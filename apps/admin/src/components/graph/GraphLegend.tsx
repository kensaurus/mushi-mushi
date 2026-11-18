/**
 * FILE: apps/admin/src/components/graph/GraphLegend.tsx
 * PURPOSE: In-canvas legend so a first-time visitor can decode the colors
 *          without opening the help drawer. Open by default (the dots alone
 *          named nothing); it collapses to a one-line summary of swatches.
 */

import { useState } from 'react'
import { NODE_COLORS } from '../../lib/tokens'
import { readVizToken } from '../../lib/vizTokens'
import { NODE_TYPE_LABELS, NODE_TYPES } from './types'

const LEGEND_EDGE_SPECS: Array<{ key: string; label: string; token: string }> = [
  { key: 'regression_of', label: 'regression', token: 'viz-flow-danger' },
  { key: 'fix_verified', label: 'fix verified', token: 'viz-score-ok' },
  { key: 'related', label: 'other', token: 'viz-graph-muted' },
]

export function GraphLegend() {
  // Open by default: a row of twelve unlabelled dots decoded nothing.
  const [open, setOpen] = useState(true)
  const edgeColors = LEGEND_EDGE_SPECS.map((spec) => ({
    ...spec,
    color: readVizToken(spec.token),
  }))
  return (
    <div className="rounded-md border border-edge-subtle bg-surface-raised/95 backdrop-blur shadow-raised text-2xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-fg-secondary hover:text-fg w-full"
        aria-expanded={open}
      >
        <span className="font-medium">Legend</span>
        <span className="inline-flex items-center gap-1">
          {NODE_TYPES.map((nt) => (
            <span
              key={nt}
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: NODE_COLORS[nt] }}
              aria-hidden="true"
            />
          ))}
        </span>
        <span className="text-fg-faint">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2 pt-0 space-y-1.5 border-t border-edge-subtle">
          <div>
            <div className="text-3xs text-fg-secondary mt-1.5 mb-0.5 font-semibold">Nodes</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {NODE_TYPES.map((nt) => (
                <div key={nt} className="flex items-center gap-1.5 text-fg-muted">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: NODE_COLORS[nt] }}
                    aria-hidden="true"
                  />
                  {NODE_TYPE_LABELS[nt]}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-3xs text-fg-secondary mb-0.5 font-semibold">Edges</div>
            <div className="space-y-0.5">
              {edgeColors.map((e) => (
                <div key={e.key} className="flex items-center gap-1.5 text-fg-muted">
                  <span
                    className="inline-block h-px w-4"
                    style={{ backgroundColor: e.color, height: 2 }}
                    aria-hidden="true"
                  />
                  {e.label}
                </div>
              ))}
              <div className="flex items-center gap-1.5 text-fg-muted">
                <span className="text-3xs font-mono text-fg-faint">∿</span>
                animated = fix attempted
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
