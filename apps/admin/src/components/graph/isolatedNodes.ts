/**
 * FILE: apps/admin/src/components/graph/isolatedNodes.ts
 * PURPOSE: "Hide isolated nodes" for the bug-cluster map. A node is isolated when no enabled
 *          edge links it to another visible node. Hiding them tidies a busy map, but when
 *          every node is isolated (a young map: 2 nodes, 0 edges) hiding leaves an empty canvas
 *          that reads as broken, so then they stay visible.
 */

import type { GraphEdge, GraphNode } from './types'

export interface IsolatedFilterResult {
  nodes: GraphNode[]
  /** How many isolated nodes were hidden. */
  hidden: number
  /** Every node is isolated, so none were hidden even though the option is on. */
  allIsolated: boolean
}

export function filterIsolated(
  nodes: GraphNode[],
  edges: readonly GraphEdge[],
  isEdgeEnabled: (edgeType: string) => boolean,
  hide: boolean,
): IsolatedFilterResult {
  if (!hide || nodes.length === 0) return { nodes, hidden: 0, allIsolated: false }
  const visible = new Set(nodes.map((n) => n.id))
  const connected = new Set<string>()
  for (const e of edges) {
    if (!isEdgeEnabled(e.edge_type)) continue
    if (visible.has(e.source_node_id) && visible.has(e.target_node_id)) {
      connected.add(e.source_node_id)
      connected.add(e.target_node_id)
    }
  }
  if (connected.size === 0) return { nodes, hidden: 0, allIsolated: true }
  const kept = nodes.filter((n) => connected.has(n.id))
  return { nodes: kept, hidden: nodes.length - kept.length, allIsolated: false }
}
