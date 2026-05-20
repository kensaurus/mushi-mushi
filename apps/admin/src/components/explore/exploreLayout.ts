/**
 * Column/swimlane layout for the Explore graph.
 *
 * Arranges nodes in vertical columns, one column per architectural layer
 * (UI → Library → Backend → Tests → Config → Other).  Within each column,
 * nodes wrap into sub-columns every ROWS_PER_SUBCOL rows.  This replaces
 * the generic ring layout which becomes unreadable above ~30 nodes.
 *
 * Visual result (schematic):
 *
 *  [UI]            [Library]   [Backend]   [Tests]                 [Other]
 *  node  node      node        node        node  node  node  …     node  node
 *  node  node      node                   node  node  node  …
 *  node  node                             node  node  node  …
 *  …                                      …
 *
 * X origin is the left edge of the UI column; the caller (ReactFlow) can
 * pan/fit-view to centre the canvas.
 */

import type { ExploreNode } from './exploreTypes'
import { LAYER_ORDER } from './exploreLayers'

/** Pixels reserved per node (width). Chips are max 210 px; add some breathing room. */
const NODE_W = 220
/** Pixels per node row (height). ExploreNodeChip is ~48 px tall at 2 lines. */
const NODE_H = 54
/** Horizontal gap between sub-columns within the same layer. */
const SUB_COL_GAP = 8
/** Horizontal gap between adjacent layer groups. */
const LAYER_GAP = 40
/** Vertical gap between rows. */
const ROW_GAP = 8
/** Max rows before a new sub-column is started within a layer group. */
const ROWS_PER_SUBCOL = 16

/**
 * Vertical space reserved above the first row for layer column header labels.
 * Headers are placed at y=0; node rows start at y=HEADER_H.
 * Keeping all content at y>=0 prevents fitView from including negative space.
 */
export const EXPLORE_HEADER_H = 44

export function exploreGridLayout(
  nodes: ExploreNode[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (nodes.length === 0) return positions

  // Group by layer, preserving LAYER_ORDER
  const byLayer = new Map<string, ExploreNode[]>()
  for (const l of LAYER_ORDER) byLayer.set(l, [])
  for (const n of nodes) {
    const layer = (n.metadata.layer as string) ?? 'other'
    if (!byLayer.has(layer)) byLayer.set(layer, [])
    byLayer.get(layer)!.push(n)
  }

  let xCursor = 0

  for (const layer of LAYER_ORDER) {
    const group = byLayer.get(layer)
    if (!group || group.length === 0) continue

    const subCols = Math.ceil(group.length / ROWS_PER_SUBCOL)

    for (let i = 0; i < group.length; i++) {
      const subCol = Math.floor(i / ROWS_PER_SUBCOL)
      const row = i % ROWS_PER_SUBCOL
      positions.set(group[i].id, {
        x: xCursor + subCol * (NODE_W + SUB_COL_GAP),
        y: EXPLORE_HEADER_H + row * (NODE_H + ROW_GAP),
      })
    }

    xCursor += subCols * (NODE_W + SUB_COL_GAP) + LAYER_GAP
  }

  return positions
}
