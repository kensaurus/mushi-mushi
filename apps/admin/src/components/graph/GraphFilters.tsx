/**
 * FILE: apps/admin/src/components/graph/GraphFilters.tsx
 * PURPOSE: Quick-views row + search + node-type/edge-type filter chips. The
 *          page owns the filter state; this is purely presentational and
 *          dispatches setter callbacks.
 */

import { Input } from '../ui'
import { NODE_COLORS } from '../../lib/tokens'
import {
  EDGE_LABELS,
  EDGE_TYPES,
  NODE_TYPE_LABELS,
  NODE_TYPES,
  type EdgeType,
  type NodeType,
} from './types'

const QUICK_VIEWS = [
  { key: 'all', label: 'All' },
  { key: 'regressions', label: 'Regressions' },
  { key: 'fragile', label: 'Fragile components' },
  { key: 'fixes', label: 'Fix coverage' },
] as const
export type QuickView = (typeof QUICK_VIEWS)[number]['key']

interface QuickViewsProps {
  hideSingletons: boolean
  singletonCount: number
  onApplyView: (preset: QuickView) => void
  onToggleSingletons: (next: boolean) => void
  onRelayout: () => void
}

export function QuickViewsRow({
  hideSingletons,
  singletonCount,
  onApplyView,
  onToggleSingletons,
  onRelayout,
}: QuickViewsProps) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-2 items-center">
      <span className="text-2xs text-fg-faint uppercase tracking-wider mr-1">Quick views:</span>
      {QUICK_VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => onApplyView(v.key)}
          className="px-2 py-0.5 rounded-sm text-2xs border border-edge-subtle bg-surface-raised/50 text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors"
        >
          {v.label}
        </button>
      ))}
      <span className="ml-auto inline-flex items-center gap-2">
        <label className="inline-flex items-center gap-1.5 cursor-pointer text-2xs text-fg-muted">
          <input
            type="checkbox"
            checked={hideSingletons}
            onChange={(e) => onToggleSingletons(e.target.checked)}
            className="h-3 w-3 accent-brand"
          />
          Hide isolated nodes{singletonCount > 0 ? ` (${singletonCount})` : ''}
        </label>
        <button
          type="button"
          onClick={onRelayout}
          className="px-2 py-0.5 rounded-sm text-2xs border border-edge-subtle bg-surface-raised/50 text-fg-secondary hover:bg-surface-overlay hover:text-fg"
          title="Shuffle node positions"
        >
          ↻ Re-layout
        </button>
      </span>
    </div>
  )
}

interface FilterChipsProps {
  search: string
  onSearchChange: (v: string) => void
  enabledNodeTypes: Set<NodeType>
  enabledEdgeTypes: Set<EdgeType>
  onToggleNodeType: (nt: NodeType) => void
  onToggleEdgeType: (et: EdgeType) => void
}

export function GraphFilterChips({
  search,
  onSearchChange,
  enabledNodeTypes,
  enabledEdgeTypes,
  onToggleNodeType,
  onToggleEdgeType,
}: FilterChipsProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search node label…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-64"
        />
        <div className="flex flex-wrap gap-1">
          {NODE_TYPES.map((nt) => {
            const active = enabledNodeTypes.has(nt)
            return (
              <button
                key={nt}
                type="button"
                onClick={() => onToggleNodeType(nt)}
                className={`px-2 py-0.5 rounded-sm text-2xs border ${
                  active
                    ? 'border-edge bg-surface-raised text-fg'
                    : 'border-edge-subtle bg-transparent text-fg-faint'
                }`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                  style={{ backgroundColor: NODE_COLORS[nt] }}
                />
                {NODE_TYPE_LABELS[nt]}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {EDGE_TYPES.map((et) => {
          const active = enabledEdgeTypes.has(et)
          return (
            <button
              key={et}
              type="button"
              onClick={() => onToggleEdgeType(et)}
              className={`px-2 py-0.5 rounded-sm text-3xs border font-mono ${
                active
                  ? 'border-edge bg-surface-raised text-fg-secondary'
                  : 'border-edge-subtle bg-transparent text-fg-faint'
              }`}
            >
              {EDGE_LABELS[et]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
