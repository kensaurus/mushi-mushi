/**
 * FILE: apps/admin/src/components/graph/graphLayout.ts
 * PURPOSE: Force-directed layout helper. Pure function so reactflow can
 *          re-layout on filter changes without state churn. The `seed` argument
 *          lets the "Re-layout" button shake the graph into a new arrangement
 *          without changing data.
 *
 *          Implementation: cluster-ring seeding (one ring position per
 *          node_type, matching the legend's mental model) refined by a
 *          synchronous d3-force simulation. The previous hand-rolled pass had
 *          attraction but no repulsion or collision, and sized cluster rings
 *          in node-counts rather than pixels — chips are ~200px wide, so
 *          anything denser than a handful of nodes stacked on top of itself.
 *          d3's forceCollide is the missing half: it separates nodes by their
 *          *rendered* footprint, which we estimate from the label the same way
 *          NodeChip truncates it.
 */

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { nodeMetadataValue, type GraphEdge, type GraphNode } from './types'

/**
 * Estimated rendered chip footprint, in px. Mirrors NodeChip: text-2xs
 * (~6.2px/char average), color dot + gaps + px-2.5 padding ≈ 44px chrome,
 * truncation at max-w-48 (192px). Height = py-1 + one text-2xs line.
 * Exported so GraphPage can hand the same numbers to React Flow
 * (initialWidth/initialHeight) and keep fitView honest before first measure.
 */
export function estimateNodeSize(node: GraphNode): { width: number; height: number } {
  const hasOcc = nodeMetadataValue(node, 'occurrence_count') != null
  const width = Math.min(192, Math.round(node.label.length * 6.2) + 44 + (hasOcc ? 24 : 0))
  return { width: Math.max(64, width), height: 26 }
}

interface SimNode extends SimulationNodeDatum {
  id: string
  collideRadius: number
}

/** Deterministic PRNG (mulberry32) so the same seed reproduces the same
 *  arrangement — d3-force otherwise jiggles coincident nodes with
 *  Math.random, which would make "Re-layout" impossible to undo. */
function seededRandom(seed: number): () => number {
  let a = (seed * 0x9e3779b9 + 0x6d2b79f5) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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

  const groupKeys = [...groupBy.keys()]
  const seedOffset = (seed * Math.PI) / 7

  // Cluster ring radius in *pixels of chips*, not node-counts: enough
  // circumference for every chip in the cluster plus breathing room.
  const clusterRadii = new Map<string, number>()
  for (const key of groupKeys) {
    const group = groupBy.get(key)!
    if (group.length <= 1) {
      clusterRadii.set(key, 0)
      continue
    }
    const perimeterNeeded = group.reduce(
      (sum, n) => sum + estimateNodeSize(n).width + 24,
      0,
    )
    clusterRadii.set(key, Math.max(110, perimeterNeeded / (2 * Math.PI)))
  }
  const maxClusterRadius = Math.max(110, ...clusterRadii.values())

  // Ring radius so adjacent clusters can never collide:
  //   chord(R, n) = 2 R sin(π / n)  must be ≥ 2 · maxClusterRadius + buffer.
  const buffer = 160
  const ringN = Math.max(2, groupKeys.length)
  const chordTarget = 2 * maxClusterRadius + buffer
  const ringRadius = Math.max(420, chordTarget / (2 * Math.sin(Math.PI / ringN)))

  const groupCenters = new Map<string, { x: number; y: number }>()
  const simNodes: SimNode[] = []
  const anchorX = new Map<string, number>()
  const anchorY = new Map<string, number>()

  groupKeys.forEach((key, gi) => {
    const groupNodes = groupBy.get(key)!
    const groupAngle = (2 * Math.PI * gi) / Math.max(1, groupKeys.length) + seedOffset
    const gc = {
      x: ringRadius * Math.cos(groupAngle),
      y: ringRadius * Math.sin(groupAngle),
    }
    groupCenters.set(key, gc)
    const innerRadius = clusterRadii.get(key) ?? 0
    groupNodes.forEach((nNode, ni) => {
      const a = (2 * Math.PI * ni) / Math.max(1, groupNodes.length) + seedOffset * 0.3
      const { width, height } = estimateNodeSize(nNode)
      simNodes.push({
        id: nNode.id,
        x: gc.x + innerRadius * Math.cos(a),
        y: gc.y + innerRadius * Math.sin(a),
        // Chips are wide and short; half the diagonal over-separates rows,
        // half the width alone lets corners kiss. Split the difference.
        collideRadius: (width + height) / 4 + 10,
      })
      anchorX.set(nNode.id, gc.x)
      anchorY.set(nNode.id, gc.y)
    })
  })

  const nodeIds = new Set(simNodes.map((s) => s.id))
  const links: SimulationLinkDatum<SimNode>[] = edges
    .filter((e) => nodeIds.has(e.source_node_id) && nodeIds.has(e.target_node_id))
    .map((e) => ({ source: e.source_node_id, target: e.target_node_id }))

  // Synchronous simulation: stop the internal timer and hand-tick so the
  // caller keeps a pure, render-free function. ~200 ticks with default
  // alphaDecay reaches alphaMin — a settled, repeatable arrangement.
  const sim = forceSimulation<SimNode>(simNodes)
    .randomSource(seededRandom(seed + 1))
    .force(
      'link',
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
        .id((d) => d.id)
        .distance(150)
        .strength(0.25),
    )
    .force('charge', forceManyBody<SimNode>().strength(-160).distanceMax(600))
    .force(
      'collide',
      forceCollide<SimNode>()
        .radius((d) => d.collideRadius)
        .strength(0.9)
        .iterations(2),
    )
    // Gentle pull back toward each node's cluster centre so the legend's
    // by-type grouping survives the physics.
    .force('clusterX', forceX<SimNode>((d) => anchorX.get(d.id) ?? 0).strength(0.06))
    .force('clusterY', forceY<SimNode>((d) => anchorY.get(d.id) ?? 0).strength(0.06))
    .stop()

  for (let i = 0; i < 200; i++) sim.tick()

  for (const s of simNodes) {
    positions.set(s.id, { x: s.x ?? 0, y: s.y ?? 0 })
  }
  return positions
}
