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
 *          Wave W (2026-05-20) — container-aware layout: nodes stretch to
 *          fill the hero width; edge pills wrap long action titles.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { ReactFlow, ReactFlowProvider, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { HeroActNode, HeroDecideNode, HeroVerifyNode } from './HeroNodes'
import { HeroGradientEdge } from './HeroGradientEdge'
import {
  buildHeroEdges,
  buildHeroNodes,
  computeHeroLayout,
  type HeroActData,
  type HeroDecideData,
  type HeroEdgeData,
  type HeroLayoutMetrics,
  type HeroNodeData,
  type HeroVerifyData,
} from './heroFlow.data'
import type { OperatorTraceLine } from './operatorTrace'

const NODE_TYPES = {
  heroDecide: HeroDecideNode,
  heroAct: HeroActNode,
  heroVerify: HeroVerifyNode,
}
const EDGE_TYPES = { heroGradient: HeroGradientEdge }

// Extra top slack so edge pills (stacked above the bezier) don't clip.
const CANVAS_PADDING_Y = 18

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
  operatorTraces?: {
    decide: OperatorTraceLine[]
    act: OperatorTraceLine[]
    verify: OperatorTraceLine[]
  }
}

export function HeroFlow(props: HeroFlowProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const measure = () => setContainerWidth(el.clientWidth)
    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout: HeroLayoutMetrics = useMemo(
    () =>
      computeHeroLayout(containerWidth || 960, {
        expanded: Boolean(props.expandedTile),
      }),
    [containerWidth, props.expandedTile],
  )

  const nodes: Node<HeroNodeData>[] = useMemo(
    () =>
      buildHeroNodes({
        scope: props.scope,
        decide: props.decide,
        act: props.act,
        verify: props.verify,
        layout,
        expanded: props.expandedTile,
        onToggle: props.onToggleTile,
        decideAccessory: props.decideAccessory,
        operatorTraces: props.operatorTraces,
      }),
    [
      props.scope,
      props.decide,
      props.act,
      props.verify,
      props.expandedTile,
      props.onToggleTile,
      props.decideAccessory,
      props.operatorTraces,
      layout,
    ],
  )

  const edges: Edge<HeroEdgeData>[] = useMemo(
    () =>
      buildHeroEdges({
        decide: props.decide,
        act: props.act,
        verify: props.verify,
        layout,
      }),
    [props.decide, props.act, props.verify, layout],
  )

  const canvasHeight = layout.nodeHeight + CANVAS_PADDING_Y * 2

  return (
    <div
      ref={containerRef}
      data-hero-flow
      className="relative w-full overflow-x-clip overflow-y-visible"
      style={{ height: canvasHeight }}
    >
      {containerWidth > 0 && (
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            fitView
            fitViewOptions={{
              padding: 0.02,
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
      )}
    </div>
  )
}
