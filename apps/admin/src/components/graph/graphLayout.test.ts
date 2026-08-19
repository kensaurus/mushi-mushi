/**
 * FILE: graphLayout.test.ts
 * PURPOSE: Regression tests for the knowledge-graph layout. The previous
 *          hand-rolled placer sized cluster rings in node-counts (22px/node)
 *          against ~200px-wide chips and ran attraction with no collision —
 *          dense clusters rendered as a single stack of overlapping chips.
 *          These tests pin the two properties that matter:
 *            1. no two chips overlap (estimated footprints stay separated)
 *            2. same seed → same arrangement (Re-layout is reproducible)
 */

import { describe, it, expect } from 'vitest'
import { estimateNodeSize, layoutNodes } from './graphLayout'
import type { GraphEdge, GraphNode } from './types'

function makeGraph(componentCount: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  for (let i = 0; i < componentCount; i++) {
    nodes.push({
      id: `component-${i}`,
      node_type: 'component',
      label: `CheckoutPaymentButton_${i}`,
      metadata: { occurrence_count: i % 3 === 0 ? 4 : undefined },
    })
  }
  // A hub report_group wired to every component — the shape that used to
  // collapse everything onto the hub's centroid.
  nodes.push({ id: 'group-hub', node_type: 'report_group', label: 'Checkout crashes', metadata: {} })
  for (let i = 0; i < componentCount; i++) {
    edges.push({
      id: `e-${i}`,
      source_node_id: 'group-hub',
      target_node_id: `component-${i}`,
      edge_type: 'reports_against',
    } as GraphEdge)
  }
  return { nodes, edges }
}

/** Axis-aligned rectangle overlap on estimated chip footprints. */
function overlappingPairs(
  nodes: GraphNode[],
  positions: Map<string, { x: number; y: number }>,
  slack = 0,
): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = positions.get(nodes[i].id)!
      const b = positions.get(nodes[j].id)!
      const sa = estimateNodeSize(nodes[i])
      const sb = estimateNodeSize(nodes[j])
      // nodeOrigin is [0.5, 0.5] on GraphCanvas, so positions are centres.
      const xOverlap = Math.abs(a.x - b.x) < (sa.width + sb.width) / 2 - slack
      const yOverlap = Math.abs(a.y - b.y) < (sa.height + sb.height) / 2 - slack
      if (xOverlap && yOverlap) out.push([nodes[i].id, nodes[j].id])
    }
  }
  return out
}

describe('layoutNodes', () => {
  it('separates a dense 25-component cluster (the stacked-chips bug)', () => {
    const { nodes, edges } = makeGraph(25)
    const positions = layoutNodes(nodes, edges, 0)
    expect(positions.size).toBe(nodes.length)
    // Allow a few px of estimated-footprint kiss (estimates are approximate);
    // the failing pre-fix layout had dozens of fully-stacked pairs.
    const overlaps = overlappingPairs(nodes, positions, 6)
    expect(overlaps, `overlapping chip pairs: ${overlaps.map((p) => p.join('+')).join(', ')}`).toEqual([])
  })

  it('is deterministic for a given seed and changes with the seed', () => {
    const { nodes, edges } = makeGraph(12)
    const a = layoutNodes(nodes, edges, 3)
    const b = layoutNodes(nodes, edges, 3)
    const c = layoutNodes(nodes, edges, 4)
    for (const n of nodes) {
      expect(a.get(n.id)).toEqual(b.get(n.id))
    }
    const moved = nodes.some((n) => {
      const pa = a.get(n.id)!
      const pc = c.get(n.id)!
      return Math.abs(pa.x - pc.x) > 1 || Math.abs(pa.y - pc.y) > 1
    })
    expect(moved).toBe(true)
  })

  it('handles the empty graph', () => {
    expect(layoutNodes([], [], 0).size).toBe(0)
  })
})
