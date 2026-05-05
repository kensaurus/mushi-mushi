/**
 * FILE: apps/admin/src/components/graph/graphLayout.ts
 * PURPOSE: Force-directed layout helper. Pure function so reactflow can
 *          re-layout on filter changes without state churn. The `seed` argument
 *          lets the "Re-layout" button shake the graph into a new arrangement
 *          without changing data.
 */

import type { GraphEdge, GraphNode } from './types'

export function layoutNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  seed = 0,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (nodes.length === 0) return positions

  const groupBy = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    const k = n.node_type
    if (!groupBy.has(k)) groupBy.set(k, [])
    groupBy.get(k)!.push(n)
  }

  // Place each node-type cluster on a circle ring around the canvas center.
  const center = { x: 0, y: 0 }
  const groupKeys = [...groupBy.keys()]
  const seedOffset = (seed * Math.PI) / 7

  // Per-cluster inner radius. Singletons sit exactly at the cluster centre
  // (no point spreading one node around an invisible mini-ring).
  const clusterRadii = new Map<string, number>()
  for (const key of groupKeys) {
    const count = groupBy.get(key)!.length
    if (count <= 1) {
      clusterRadii.set(key, 0)
    } else {
      // ~22px per node up to a 220px cap keeps dense clusters readable;
      // floor of 60 keeps 2-node clusters from collapsing into each other.
      clusterRadii.set(key, Math.max(60, Math.min(220, count * 22)))
    }
  }
  const maxClusterRadius = Math.max(60, ...clusterRadii.values())

  // Compute the ring radius so adjacent clusters can never collide:
  //   chord(R, n) = 2 R sin(π / n)  must be ≥ 2 · maxClusterRadius + buffer.
  // Without this the original fixed 420 ring overlapped any time the largest
  // cluster grew past ~180px (e.g. 25 components after a v2 inventory ingest).
  const buffer = 120
  const n = Math.max(2, groupKeys.length)
  const chordTarget = 2 * maxClusterRadius + buffer
  const ringRadius = Math.max(420, chordTarget / (2 * Math.sin(Math.PI / n)))

  groupKeys.forEach((key, gi) => {
    const groupNodes = groupBy.get(key)!
    const groupAngle = (2 * Math.PI * gi) / Math.max(1, groupKeys.length) + seedOffset
    const groupCenter = {
      x: center.x + ringRadius * Math.cos(groupAngle),
      y: center.y + ringRadius * Math.sin(groupAngle),
    }
    const innerRadius = clusterRadii.get(key) ?? 0
    groupNodes.forEach((nNode, ni) => {
      const a = (2 * Math.PI * ni) / Math.max(1, groupNodes.length) + seedOffset * 0.3
      positions.set(nNode.id, {
        x: groupCenter.x + innerRadius * Math.cos(a),
        y: groupCenter.y + innerRadius * Math.sin(a),
      })
    })
  })

  // Light edge attraction pass: pull connected nodes ~5% toward each other.
  for (let pass = 0; pass < 8; pass++) {
    for (const e of edges) {
      const a = positions.get(e.source_node_id)
      const b = positions.get(e.target_node_id)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const move = 0.04
      a.x += dx * move
      a.y += dy * move
      b.x -= dx * move
      b.y -= dy * move
    }
  }

  return positions
}
