/**
 * FILE: apps/admin/src/components/hero-flow/HeroFlow.tsx
 * PURPOSE: ReactFlow canvas for the Decide → Act → Verify page hero lane.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { HeroActNode, HeroDecideNode, HeroVerifyNode } from './HeroNodes'
import { HeroGradientEdge } from './HeroGradientEdge'
import { FlowCanvasBackground } from '../flow-primitives/FlowCanvasBackground'
import { HeroFlowProvider } from './HeroFlowContext'
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

const CANVAS_PADDING_Y = 12

export interface HeroFlowProps {
  scope: string
  decide: HeroDecideData
  act: HeroActData
  verify: HeroVerifyData
  expandedTile: 'decide' | 'act' | 'verify' | null
  onToggleTile: (tile: 'decide' | 'act' | 'verify') => void
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

  const hasActiveCta = Boolean(props.act.action?.primary)
  const refreshKey = `${props.decide.metric ?? ''}|${props.decide.severity}|${props.act.action?.title ?? ''}|${props.verify.detail}`

  const layout: HeroLayoutMetrics = useMemo(
    () =>
      computeHeroLayout(containerWidth || 960, {
        expanded: Boolean(props.expandedTile),
        hasActiveCta,
      }),
    [containerWidth, props.expandedTile, hasActiveCta],
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

  const canvasHeight = layout.nodeHeight + CANVAS_PADDING_Y * 2 + 4

  return (
    <HeroFlowProvider
      expanded={props.expandedTile}
      hasActiveCta={hasActiveCta}
      refreshKey={refreshKey}
    >
      <div
        ref={containerRef}
        data-hero-flow
        className="flow-canvas-chrome flow-canvas-chrome--hero hero-flow-lane relative w-full overflow-visible"
        style={{ height: canvasHeight }}
        role="group"
        aria-label="Page workflow snapshot"
      >
        {containerWidth > 0 && (
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.02, includeHiddenNodes: false }}
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
            >
              <FlowCanvasBackground density="hero" />
            </ReactFlow>
          </ReactFlowProvider>
        )}
      </div>
    </HeroFlowProvider>
  )
}
