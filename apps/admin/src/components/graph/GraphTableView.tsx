/**
 * FILE: apps/admin/src/components/graph/GraphTableView.tsx
 * PURPOSE: Screen-reader-friendly fallback for the React Flow canvas. Renders
 *          the graph as two paired tables (nodes + edges) keyed by stable IDs
 *          so AT can announce relationships and keyboard users can focus and
 *          select nodes.
 *
 * Wave S (2026-04-23) — Lightweight windowing.
 *
 * Prior revisions `nodes.map((n) => ...)` rendered every row unconditionally.
 * On knowledge graphs with >2k nodes that dropped the admin console frame
 * budget below 20 fps on mid-range laptops — operators reported the
 * accessibility toggle "freezing the browser" during graph imports.
 *
 * We deliberately avoid pulling in a virtualization library (tanstack/react
 * virtual would add ~8 KB gzipped and the rest of the admin console doesn't
 * need it). Instead we cap the initial render at `PAGE_SIZE` rows and
 * expose a plain "Show N more" button; AT users can page through without
 * the overhead of a custom scroll listener, and we keep the bundle budget
 * intact. The `<h3>` count reflects the full dataset size so operators
 * always know what's hidden.
 */

import { useMemo, useState } from 'react'
import { Btn, Card } from '../ui'
import { EDGE_LABELS, NODE_TYPE_LABELS, nodeMetadataValue, type GraphEdge, type GraphNode } from './types'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNodeId: string | null
  blastRadiusIds: Set<string>
  onSelect: (node: GraphNode) => void
}

// Matches the `max-h-[480px]` scroll region — at ~22px per row we fit ~22
// rows on screen, so 250 keeps a healthy off-screen prefetch buffer while
// preventing the browser from ever laying out the full 2k+ at once.
const PAGE_SIZE = 250

export function GraphTableView({ nodes, edges, selectedNodeId, blastRadiusIds, onSelect }: Props) {
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const [nodeLimit, setNodeLimit] = useState(PAGE_SIZE)
  const [edgeLimit, setEdgeLimit] = useState(PAGE_SIZE)

  const visibleNodes = useMemo(() => nodes.slice(0, nodeLimit), [nodes, nodeLimit])
  const visibleEdges = useMemo(() => edges.slice(0, edgeLimit), [edges, edgeLimit])

  const nodeOverflow = nodes.length - visibleNodes.length
  const edgeOverflow = edges.length - visibleEdges.length

  return (
    <div className="grid gap-3 md:grid-cols-2" role="region" aria-label="Knowledge graph table view">
      <Card className="p-2">
        <h3 className="text-2xs uppercase tracking-wider text-fg-faint mb-2 px-1">
          Nodes ({nodes.length}
          {nodeOverflow > 0 ? ` · showing ${visibleNodes.length}` : ''})
        </h3>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-2xs" aria-label="Graph nodes">
            <thead className="text-fg-faint sticky top-0 bg-surface-raised">
              <tr>
                <th scope="col" className="text-left font-medium px-1 py-1">Type</th>
                <th scope="col" className="text-left font-medium px-1 py-1">Label</th>
                <th scope="col" className="text-right font-medium px-1 py-1">Occ.</th>
                <th scope="col" className="sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleNodes.map((n) => {
                const occ = nodeMetadataValue(n, 'occurrence_count')
                const isSelected = selectedNodeId === n.id
                const inBlast = blastRadiusIds.has(n.id)
                return (
                  <tr
                    key={n.id}
                    className={`border-t border-edge-subtle ${isSelected ? 'bg-surface-overlay' : inBlast ? 'bg-warn/5' : ''}`}
                  >
                    <td className="px-1 py-1 text-fg-muted">{NODE_TYPE_LABELS[n.node_type] ?? n.node_type}</td>
                    <td className="px-1 py-1 text-fg break-words">{n.label}</td>
                    <td className="px-1 py-1 text-right font-mono text-fg-faint">{occ ?? '—'}</td>
                    <td className="px-1 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => onSelect(n)}
                        aria-pressed={isSelected}
                        className="text-2xs text-brand hover:text-brand-hover px-1"
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {nodeOverflow > 0 ? (
          <div className="flex items-center justify-between gap-2 px-1 pt-2">
            <span className="text-2xs text-fg-faint">
              {nodeOverflow.toLocaleString()} more hidden
            </span>
            <div className="flex gap-1">
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => setNodeLimit((l) => l + PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, nodeOverflow)} more
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => setNodeLimit(nodes.length)}
              >
                Show all
              </Btn>
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="p-2">
        <h3 className="text-2xs uppercase tracking-wider text-fg-faint mb-2 px-1">
          Edges ({edges.length}
          {edgeOverflow > 0 ? ` · showing ${visibleEdges.length}` : ''})
        </h3>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-2xs" aria-label="Graph edges">
            <thead className="text-fg-faint sticky top-0 bg-surface-raised">
              <tr>
                <th scope="col" className="text-left font-medium px-1 py-1">From</th>
                <th scope="col" className="text-left font-medium px-1 py-1">Relation</th>
                <th scope="col" className="text-left font-medium px-1 py-1">To</th>
                <th scope="col" className="text-right font-medium px-1 py-1">Wt.</th>
              </tr>
            </thead>
            <tbody>
              {visibleEdges.map((e) => {
                const src = nodesById.get(e.source_node_id)
                const tgt = nodesById.get(e.target_node_id)
                return (
                  <tr key={e.id} className="border-t border-edge-subtle">
                    <td className="px-1 py-1 text-fg break-words">{src?.label ?? e.source_node_id}</td>
                    <td className="px-1 py-1 text-fg-muted font-mono">{EDGE_LABELS[e.edge_type] ?? e.edge_type}</td>
                    <td className="px-1 py-1 text-fg break-words">{tgt?.label ?? e.target_node_id}</td>
                    <td className="px-1 py-1 text-right font-mono text-fg-faint">{e.weight}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {edgeOverflow > 0 ? (
          <div className="flex items-center justify-between gap-2 px-1 pt-2">
            <span className="text-2xs text-fg-faint">
              {edgeOverflow.toLocaleString()} more hidden
            </span>
            <div className="flex gap-1">
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => setEdgeLimit((l) => l + PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, edgeOverflow)} more
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => setEdgeLimit(edges.length)}
              >
                Show all
              </Btn>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  )
}
