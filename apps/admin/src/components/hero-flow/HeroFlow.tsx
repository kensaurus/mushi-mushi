/**
 * FILE: apps/admin/src/components/hero-flow/HeroFlow.tsx
 * PURPOSE: ReactFlow canvas that renders the Decide → Act → Verify lane
 *          for the page hero. Three custom nodes + two gradient edges.
 *          Pan/zoom/selection are all locked — this is a narrative
 *          diagram of the operator's loop on a single page, not a
 *          draggable canvas. The hero stays consistent with the
 *          dashboard's <PdcaFlow /> so the two flows feel like one
 *          system: same gradient bezier edges, same marching-ants
 *          animation, same traveling-dots overlay when work is in
 *          flight.
 *
 *          Wave V (2026-05-08) — replaces the previous CSS-grid hero
 *          (5-column flex with `<FlowArrow />` between siblings) so the
 *          edges are real SVG bezier paths that bend on resize, the
 *          severity ring + node glow can be driven by the same flow
 *          tokens the dashboard uses, and clicking outside a node
 *          collapses every tile in one place.
 */
import { useMemo, type ReactNode } from 'react'

import { ReactFlow, ReactFlowProvider, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { HeroActNode, HeroDecideNode, HeroVerifyNode } from './HeroNodes'
import { HeroGradientEdge } from './HeroGradientEdge'
import {
  buildHeroEdges,
  buildHeroNodes,
  HERO_FLOW_LAYOUT,
  type HeroActData,
  type HeroDecideData,
  type HeroEdgeData,
  type HeroNodeData,
  type HeroVerifyData,
} from './heroFlow.data'

const NODE_TYPES = {
  heroDecide: HeroDecideNode,
  heroAct: HeroActNode,
  heroVerify: HeroVerifyNode,
}
const EDGE_TYPES = { heroGradient: HeroGradientEdge }

// Padding around the 3-node lane so the bezier curves don't clip on the
// node edges. Matches `fitViewOptions.padding` so the canvas viewport
// always shows the full diagram regardless of container width.
const CANVAS_PADDING_Y = 4

export interface HeroFlowProps {
  scope: string
  decide: HeroDecideData
  act: HeroActData
  verify: HeroVerifyData
  /** Per-tile expanded state. The hero owns this so collapsing one tile
   *  via the chevron expands a different one in one render. */
  expandedTile: 'decide' | 'act' | 'verify' | null
  onToggleTile: (tile: 'decide' | 'act' | 'verify') => void
  /** Optional accessory rendered inside the Decide tile (sparkline,
   *  trend chip). Pages opt into this via the existing
   *  `decideAccessory` prop on PageHero. */
  decideAccessory?: ReactNode
}

export function HeroFlow(props: HeroFlowProps) {
  const nodes: Node<HeroNodeData>[] = useMemo(
    () =>
      buildHeroNodes({
        scope: props.scope,
        decide: props.decide,
        act: props.act,
        verify: props.verify,
        expanded: props.expandedTile,
        onToggle: props.onToggleTile,
        decideAccessory: props.decideAccessory,
      }),
    [
      props.scope,
      props.decide,
      props.act,
      props.verify,
      props.expandedTile,
      props.onToggleTile,
      props.decideAccessory,
    ],
  )

  const edges: Edge<HeroEdgeData>[] = useMemo(
    () => buildHeroEdges({ decide: props.decide, act: props.act, verify: props.verify }),
    [props.decide, props.act, props.verify],
  )

  // The hero canvas must grow taller when a tile is expanded — otherwise
  // ReactFlow clips the expanded body. We compute the height from the
  // base node height + a generous slack for the expanded slot's text.
  const canvasHeight =
    HERO_FLOW_LAYOUT.nodeHeight + (props.expandedTile ? 60 : 0) + CANVAS_PADDING_Y * 2

  return (
    <div
      data-hero-flow
      className="relative w-full overflow-hidden"
      style={{ height: canvasHeight }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{
            padding: 0.04,
            includeHiddenNodes: false,
          }}
          proOptions={{ hideAttribution: true }}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          preventScrolling={false}
          minZoom={0.5}
          maxZoom={1}
          defaultEdgeOptions={{ type: 'heroGradient' }}
        />
      </ReactFlowProvider>
    </div>
  )
}
