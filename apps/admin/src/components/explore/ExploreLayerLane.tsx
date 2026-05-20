/**
 * Horizontal Sankey-style layer view for the /explore page.
 * Groups files into architectural-layer columns (UI → Library →
 * Backend → Tests → Config → Other) with SVG bezier curves for
 * import edges. Each column shows a proportional fill bar and left-
 * accent on selected/highlighted items.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LAYER_COLORS, LAYER_LABELS, LAYER_ORDER, detectLayer } from './exploreLayers'
import type { ExploreEdge, ExploreLayer, ExploreNode } from './exploreTypes'

interface NodeRect {
  id: string
  cx: number
  cy: number
  right: number
  left: number
}

interface Props {
  nodes: ExploreNode[]
  edges: ExploreEdge[]
  selectedId: string | null
  highlightIds: Set<string>
  onSelect: (node: ExploreNode) => void
  onClear: () => void
}

function fileExt(path: string): string {
  const m = path.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ''
}

function approxLineCount(node: ExploreNode): number | null {
  const { line_start, line_end } = node.metadata
  if (line_start != null && line_end != null) return line_end - line_start + 1
  return null
}

export function ExploreLayerLane({ nodes, edges, selectedId, highlightIds, onSelect, onClear }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [rects, setRects] = useState<Map<string, NodeRect>>(new Map())
  const [innerSize, setInnerSize] = useState({ w: 0, h: 0 })

  const columns = useMemo(() => {
    const grouped = new Map<ExploreLayer, ExploreNode[]>()
    for (const n of nodes) {
      const layer = (n.metadata.layer as ExploreLayer) ?? detectLayer(n.metadata.file_path)
      const existing = grouped.get(layer) ?? []
      existing.push(n)
      grouped.set(layer, existing)
    }

    const degree = new Map<string, number>()
    for (const e of edges) {
      degree.set(e.source_node_id, (degree.get(e.source_node_id) ?? 0) + e.weight)
      degree.set(e.target_node_id, (degree.get(e.target_node_id) ?? 0) + e.weight)
    }

    return LAYER_ORDER.filter((l) => grouped.has(l)).map((l) => {
      const colNodes = grouped.get(l)!
      const top = colNodes.reduce<ExploreNode | null>((best, n) => {
        const dn = degree.get(n.id) ?? 0
        const db = best ? degree.get(best.id) ?? 0 : -1
        return dn > db ? n : best
      }, null)
      return { layer: l, label: LAYER_LABELS[l], color: LAYER_COLORS[l], nodes: colNodes, topNode: top }
    })
  }, [nodes, edges])

  const maxColSize = useMemo(() => Math.max(...columns.map((c) => c.nodes.length), 1), [columns])

  useLayoutEffect(() => {
    const measure = () => {
      const inner = innerRef.current
      if (!inner) return
      const iRect = inner.getBoundingClientRect()
      setInnerSize({ w: iRect.width, h: iRect.height })
      const next = new Map<string, NodeRect>()
      for (const [id, el] of nodeRefs.current.entries()) {
        const r = el.getBoundingClientRect()
        next.set(id, {
          id,
          cx: r.left + r.width / 2 - iRect.left,
          cy: r.top + r.height / 2 - iRect.top,
          right: r.right - iRect.left,
          left: r.left - iRect.left,
        })
      }
      setRects(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (innerRef.current) ro.observe(innerRef.current)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [columns, nodes])

  const links = useMemo(() => {
    return edges.map((e) => {
      const a = rects.get(e.source_node_id)
      const b = rects.get(e.target_node_id)
      if (!a || !b) return null
      const x1 = a.right
      const y1 = a.cy
      const x2 = b.left
      const y2 = b.cy
      const mid = (x1 + x2) / 2
      const path = `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`
      const isActive = highlightIds.has(e.source_node_id) || highlightIds.has(e.target_node_id)
      const dimmed = highlightIds.size > 0 && !isActive
      return { id: e.id, path, dimmed, active: isActive }
    }).filter((l): l is NonNullable<typeof l> => l !== null)
  }, [edges, rects, highlightIds])

  if (columns.length === 0) {
    return (
      <div className="border border-edge rounded-md bg-surface-root p-6 text-center text-2xs text-fg-muted">
        No files indexed yet.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative border border-edge rounded-md bg-surface-root overflow-auto"
      style={{ minHeight: 380 }}
      role="region"
      aria-label={`Layer breakdown with ${nodes.length} files across ${columns.length} architectural layers.`}
    >
      <div
        ref={innerRef}
        className="relative flex items-stretch gap-8 px-6 py-5 min-h-[380px] w-max min-w-full"
        onClick={(e) => { if (e.target === e.currentTarget) onClear() }}
      >
        {/* SVG overlay for bezier import edges */}
        {innerSize.w > 0 && (
          <svg
            className="absolute inset-0 pointer-events-none"
            width={innerSize.w}
            height={innerSize.h}
            style={{ zIndex: 0 }}
            aria-hidden="true"
          >
            {/* Arrows marker */}
            <defs>
              <marker id="edge-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0.5 L5,3 L0,5.5" fill="none" stroke="oklch(0.50 0 0)" strokeWidth="0.8" />
              </marker>
            </defs>
            {links.map((l) => (
              <path
                key={l.id}
                d={l.path}
                stroke="oklch(0.50 0 0)"
                strokeOpacity={l.dimmed ? 0.06 : l.active ? 0.55 : 0.22}
                strokeWidth={l.active ? 1.5 : 1}
                fill="none"
                markerEnd="url(#edge-arrow)"
              />
            ))}
          </svg>
        )}

        {columns.map((col) => {
          const pct = Math.round((col.nodes.length / maxColSize) * 100)
          return (
            <div key={col.layer} className="flex flex-col gap-2.5 min-w-[10rem] max-w-[13rem]" style={{ zIndex: 1 }}>
              {/* Column header */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: col.color }}
                    aria-hidden="true"
                  />
                  <span className="text-2xs font-semibold" style={{ color: col.color }}>{col.label}</span>
                  <span className="text-2xs text-fg-faint font-mono ml-auto">{col.nodes.length}</span>
                </div>
                {/* Proportional fill bar */}
                <div className="h-1 rounded-full bg-surface-overlay overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: col.color, opacity: 0.6 }}
                  />
                </div>
                {col.topNode && col.nodes.length > 1 && (
                  <div className="text-3xs text-fg-faint truncate" title={`Most-imported: ${col.topNode.label}`}>
                    hub: <span className="text-fg-secondary font-mono">{col.topNode.label}</span>
                  </div>
                )}
              </div>

              {/* Node cards */}
              <div className="flex flex-col gap-1.5">
                {col.nodes.map((node) => {
                  const isSelected = selectedId === node.id
                  const isHighlighted = highlightIds.size > 0 && highlightIds.has(node.id)
                  const isDimmed = highlightIds.size > 0 && !highlightIds.has(node.id)
                  const ext = fileExt(node.metadata.file_path)
                  const lines = approxLineCount(node)
                  return (
                    <button
                      key={node.id}
                      type="button"
                      ref={(el) => {
                        if (el) nodeRefs.current.set(node.id, el)
                        else nodeRefs.current.delete(node.id)
                      }}
                      onClick={() => onSelect(node)}
                      title={node.metadata.file_path}
                      style={{
                        borderLeftColor: isSelected || isHighlighted ? col.color : 'transparent',
                        borderLeftWidth: 3,
                      }}
                      className={[
                        'text-left px-2.5 py-1.5 rounded-r-md border border-l-0 border-edge-subtle/50 text-2xs',
                        'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
                        isSelected
                          ? 'bg-surface-overlay border-edge/60 text-fg font-medium shadow-sm'
                          : isHighlighted
                          ? 'bg-surface-overlay border-edge/50 text-fg'
                          : isDimmed
                          ? 'bg-surface-root text-fg-faint opacity-30'
                          : 'bg-surface-raised text-fg-secondary hover:bg-surface-overlay hover:text-fg hover:border-edge/60',
                      ].join(' ')}
                      aria-pressed={isSelected}
                    >
                      <div className="font-mono truncate leading-tight flex items-center gap-1">
                        <span className="truncate flex-1">{node.label}</span>
                        {ext && (
                          <span className="text-3xs text-fg-faint shrink-0">.{ext}</span>
                        )}
                      </div>
                      {lines != null && (
                        <div className="text-3xs text-fg-faint mt-0.5">{lines} lines</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
