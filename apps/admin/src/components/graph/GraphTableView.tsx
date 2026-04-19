/**
 * FILE: apps/admin/src/components/graph/GraphTableView.tsx
 * PURPOSE: Screen-reader-friendly fallback for the React Flow canvas. Renders
 *          the graph as two paired tables (nodes + edges) keyed by stable IDs
 *          so AT can announce relationships and keyboard users can focus and
 *          select nodes.
 */

import { useMemo } from 'react'
import { Card } from '../ui'
import { EDGE_LABELS, NODE_TYPE_LABELS, nodeMetadataValue, type GraphEdge, type GraphNode } from './types'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNodeId: string | null
  blastRadiusIds: Set<string>
  onSelect: (node: GraphNode) => void
}

export function GraphTableView({ nodes, edges, selectedNodeId, blastRadiusIds, onSelect }: Props) {
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  return (
    <div className="grid gap-3 md:grid-cols-2" role="region" aria-label="Knowledge graph table view">
      <Card className="p-2">
        <h3 className="text-2xs uppercase tracking-wider text-fg-faint mb-2 px-1">
          Nodes ({nodes.length})
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
              {nodes.map((n) => {
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
      </Card>

      <Card className="p-2">
        <h3 className="text-2xs uppercase tracking-wider text-fg-faint mb-2 px-1">
          Edges ({edges.length})
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
              {edges.map((e) => {
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
      </Card>
    </div>
  )
}
