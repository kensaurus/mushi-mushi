/**
 * FILE: apps/admin/src/components/graph/GraphStoryboard.tsx
 * PURPOSE: Sparse-graph "storyboard" view that replaces the React Flow canvas
 *          when there are fewer than ~12 nodes. The full graph is overkill at
 *          that scale: nodes float in a sea of empty space and the spaghetti-
 *          arrows hide the actual story.
 *
 *          The storyboard buckets nodes by `node_type` into vertical columns
 *          (report_group → component → page → version) and draws SVG bezier
 *          curves between connected nodes — a deliberately Sankey-shaped flow
 *          so users read it left-to-right as "this report group affects these
 *          components, which break these pages on these versions."
 *
 *          Clicking a node fires the same `onNodeClick` callback the canvas
 *          uses so the side panel and blast-radius logic Just Work.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NODE_COLORS } from '../../lib/tokens'
import { NODE_TYPE_LABELS, type GraphEdge, type GraphNode, type NodeType } from './types'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNodeId: string | null
  blastRadiusIds: Set<string>
  onSelect: (node: GraphNode) => void
  onClear: () => void
}

const COLUMN_ORDER: NodeType[] = ['report_group', 'component', 'page', 'version']

interface NodeRect {
  id: string
  cx: number
  cy: number
  right: number
  left: number
}

export function GraphStoryboard({
  nodes,
  edges,
  selectedNodeId,
  blastRadiusIds,
  onSelect,
  onClear,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [rects, setRects] = useState<Map<string, NodeRect>>(new Map())
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

  // Group nodes by type into ordered columns. Empty columns are skipped so
  // a 2-type story renders as 2 columns, not 4-with-gaps.
  const columns = useMemo(() => {
    const grouped = new Map<NodeType, GraphNode[]>()
    for (const n of nodes) {
      const t = n.node_type as NodeType
      if (!COLUMN_ORDER.includes(t)) continue
      const existing = grouped.get(t) ?? []
      existing.push(n)
      grouped.set(t, existing)
    }
    return COLUMN_ORDER.filter((t) => grouped.has(t)).map((t) => ({
      type: t,
      label: NODE_TYPE_LABELS[t] ?? t,
      nodes: grouped.get(t)!,
    }))
  }, [nodes])

  // Recompute SVG link anchor points whenever layout changes.
  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current
      if (!container) return
      const cRect = container.getBoundingClientRect()
      setContainerSize({ w: cRect.width, h: cRect.height })
      const next = new Map<string, NodeRect>()
      for (const [id, el] of nodeRefs.current.entries()) {
        const r = el.getBoundingClientRect()
        next.set(id, {
          id,
          cx: r.left + r.width / 2 - cRect.left,
          cy: r.top + r.height / 2 - cRect.top,
          right: r.right - cRect.left,
          left: r.left - cRect.left,
        })
      }
      setRects(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [columns, nodes])

  const links = useMemo(() => {
    return edges
      .map((e) => {
        const a = rects.get(e.source_node_id)
        const b = rects.get(e.target_node_id)
        if (!a || !b) return null
        // Only draw left-to-right; reversed edges still render but the bezier
        // bows "backwards" which visually flags them as out-of-flow.
        const x1 = a.right
        const y1 = a.cy
        const x2 = b.left
        const y2 = b.cy
        const mid = (x1 + x2) / 2
        const path = `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`
        const dim =
          blastRadiusIds.size > 0 &&
          !blastRadiusIds.has(e.source_node_id) &&
          !blastRadiusIds.has(e.target_node_id)
        return { id: e.id, path, type: e.edge_type, weight: e.weight, dim }
      })
      .filter((l): l is NonNullable<typeof l> => l !== null)
  }, [edges, rects, blastRadiusIds])

  return (
    <div
      ref={containerRef}
      className="relative border border-edge rounded-md bg-surface-root overflow-auto"
      style={{ minHeight: 420 }}
      role="region"
      aria-label={`Sparse graph storyboard with ${nodes.length} nodes across ${columns.length} stages.`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClear()
      }}
    >
      <div className="flex items-stretch gap-12 px-8 py-6 min-h-[420px]">
        {columns.map((col) => (
          <div key={col.type} className="flex flex-col gap-3 min-w-[10rem] max-w-[14rem]">
            <div className="text-2xs uppercase tracking-wider text-fg-faint flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: NODE_COLORS[col.type] }}
                aria-hidden="true"
              />
              {col.label}
              <span className="font-mono text-fg-faint/60">({col.nodes.length})</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {col.nodes.map((node) => {
                const isSelected = selectedNodeId === node.id
                const inBlast = blastRadiusIds.has(node.id)
                const dimmed = blastRadiusIds.size > 0 && !inBlast && !isSelected
                return (
                  <button
                    key={node.id}
                    ref={(el) => {
                      if (el) nodeRefs.current.set(node.id, el)
                      else nodeRefs.current.delete(node.id)
                    }}
                    type="button"
                    onClick={() => onSelect(node)}
                    aria-pressed={isSelected}
                    style={{ borderColor: isSelected ? NODE_COLORS[col.type] : undefined }}
                    className={`
                      group/node relative z-10 text-left px-2.5 py-2 rounded-md
                      border bg-surface-raised
                      hover:bg-surface-overlay motion-safe:transition-all
                      ${isSelected ? 'shadow-raised border-2' : 'border-edge'}
                      ${dimmed ? 'opacity-40' : 'opacity-100'}
                    `}
                  >
                    <div
                      className="text-2xs font-mono text-fg-faint uppercase tracking-wider"
                      style={{ color: NODE_COLORS[col.type] }}
                    >
                      {col.label}
                    </div>
                    <div className="text-xs text-fg-secondary leading-snug line-clamp-2 mt-0.5">
                      {node.label || '(unnamed)'}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bezier links sit on top of the columns but pointer-events-none so the
          buttons remain clickable. We absolutely position the SVG to the
          measured container size so paths align pixel-perfect. */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={containerSize.w}
        height={containerSize.h}
        aria-hidden="true"
      >
        <defs>
          <marker
            id="storyboard-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="oklch(0.55 0 0)" />
          </marker>
        </defs>
        {links.map((l) => (
          <path
            key={l.id}
            d={l.path}
            fill="none"
            stroke={
              l.type === 'regression_of'
                ? 'oklch(0.65 0.22 25)'
                : l.type === 'fix_verified'
                  ? 'oklch(0.72 0.19 155)'
                  : 'oklch(0.55 0 0)'
            }
            strokeWidth={Math.max(1.5, Math.min(3, l.weight))}
            strokeOpacity={l.dim ? 0.15 : 0.55}
            markerEnd="url(#storyboard-arrow)"
          />
        ))}
      </svg>
    </div>
  )
}
