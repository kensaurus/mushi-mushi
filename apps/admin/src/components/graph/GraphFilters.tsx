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
  const allNodes = enabledNodeTypes.size === NODE_TYPES.length
  const allEdges = enabledEdgeTypes.size === EDGE_TYPES.length
  return (
    <div className="rounded-md border border-edge-subtle bg-surface-raised/30 p-2.5 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search node label…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-64"
        />
        <span className="text-2xs text-fg-faint ml-auto">
          {NODE_TYPES.filter((t) => enabledNodeTypes.has(t)).length}/{NODE_TYPES.length} node types ·{' '}
          {EDGE_TYPES.filter((t) => enabledEdgeTypes.has(t)).length}/{EDGE_TYPES.length} edge types
        </span>
      </div>

      <FilterChipGroup label="Show node types" allActive={allNodes}>
        {NODE_TYPES.map((nt) => {
          const active = enabledNodeTypes.has(nt)
          return (
            <button
              key={nt}
              type="button"
              onClick={() => onToggleNodeType(nt)}
              aria-pressed={active}
              className={`px-2 py-0.5 rounded-sm text-2xs border motion-safe:transition-colors ${
                active
                  ? 'border-edge bg-surface-raised text-fg'
                  : 'border-edge-subtle bg-transparent text-fg-faint hover:text-fg-muted'
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
      </FilterChipGroup>

      <FilterChipGroup label="Connect via edges" allActive={allEdges}>
        {EDGE_TYPES.map((et) => {
          const active = enabledEdgeTypes.has(et)
          return (
            <button
              key={et}
              type="button"
              onClick={() => onToggleEdgeType(et)}
              aria-pressed={active}
              className={`px-2 py-0.5 rounded-sm text-3xs border font-mono motion-safe:transition-colors ${
                active
                  ? 'border-edge bg-surface-raised text-fg-secondary'
                  : 'border-edge-subtle bg-transparent text-fg-faint hover:text-fg-muted'
              }`}
            >
              {EDGE_LABELS[et]}
            </button>
          )
        })}
      </FilterChipGroup>
    </div>
  )
}

interface FilterChipGroupProps {
  label: string
  allActive: boolean
  children: React.ReactNode
}

/**
 * Visually labels a row of chips so first-time users can tell node-type
 * filters from edge-type filters at a glance, instead of staring at two
 * undifferentiated chip rows. The "all" pill gives a passive read of state.
 */
function FilterChipGroup({ label, allActive, children }: FilterChipGroupProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-2xs uppercase tracking-wider text-fg-faint min-w-[6.5rem]">
        {label}
        {allActive && (
          <span className="ml-1 text-3xs text-fg-faint/60 normal-case tracking-normal">
            (all)
          </span>
        )}
      </span>
      {children}
    </div>
  )
}
