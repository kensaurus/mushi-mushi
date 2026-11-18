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
  /** No node has an enabled link (a fact about the data, whatever the option says). */
  allIsolated: boolean
}

export function filterIsolated(
  nodes: GraphNode[],
  edges: readonly GraphEdge[],
  isEdgeEnabled: (edgeType: string) => boolean,
  hide: boolean,
): IsolatedFilterResult {
  if (nodes.length === 0) return { nodes, hidden: 0, allIsolated: false }
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
  if (!hide) return { nodes, hidden: 0, allIsolated: false }
  const kept = nodes.filter((n) => connected.has(n.id))
  return { nodes: kept, hidden: nodes.length - kept.length, allIsolated: false }
}

export interface IsolatedToggleState {
  /** What the checkbox shows: the filter actually in effect, never the stored wish alone. */
  checked: boolean
  disabled: boolean
  /** Short reason shown beside a disabled box. */
  reason: string | null
}

/**
 * The "Hide isolated nodes" box must match the map. When no node has a link the
 * filter cannot hide anything without emptying the map, so the box reads
 * unticked and disabled with the reason, instead of ticked over visible nodes.
 */
export function isolatedToggleState(hide: boolean, result: IsolatedFilterResult): IsolatedToggleState {
  if (result.allIsolated) return { checked: false, disabled: true, reason: 'no links yet' }
  return { checked: hide, disabled: false, reason: null }
}
