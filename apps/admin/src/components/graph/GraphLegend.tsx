/**
 * FILE: apps/admin/src/components/graph/GraphLegend.tsx
 * PURPOSE: In-canvas legend so a first-time visitor can decode the colors
 *          without opening the help drawer. Collapsed by default to stay out
 *          of the way; the summary line still shows the highest-signal info
 *          (node-type swatches).
 */

import { useState } from 'react'
import { NODE_COLORS } from '../../lib/tokens'
import { NODE_TYPE_LABELS, NODE_TYPES } from './types'

const LEGEND_EDGE_COLORS: Array<{ key: string; label: string; color: string }> = [
  { key: 'regression_of', label: 'regression', color: 'oklch(0.65 0.22 25)' },
  { key: 'fix_verified', label: 'fix verified', color: 'oklch(0.72 0.19 155)' },
  { key: 'related', label: 'other', color: 'oklch(0.50 0 0)' },
]

export function GraphLegend() {
  const [open, setOpen] = useState(false)
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
            <div className="text-3xs uppercase tracking-wider text-fg-faint mt-1.5 mb-0.5">Nodes</div>
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
            <div className="text-3xs uppercase tracking-wider text-fg-faint mb-0.5">Edges</div>
            <div className="space-y-0.5">
              {LEGEND_EDGE_COLORS.map((e) => (
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
