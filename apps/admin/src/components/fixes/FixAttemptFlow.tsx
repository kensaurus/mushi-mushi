/**
 * FILE: apps/admin/src/components/fixes/FixAttemptFlow.tsx
 * PURPOSE: Single-row React Flow canvas that visualises one FixAttempt's
 *          journey through the PDCA pipeline (Report → Dispatch → PR →
 *          Judge → Ship). Replaces the previous plain badge-strip at the
 *          top of each FixCard so users can see at a glance *where* a fix
 *          currently is without decoding English labels.
 */

import { useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { FixAttempt } from './types'
import { buildFixAttemptEdges, buildFixAttemptNodes, type FixEdgeData, type FixStageNodeData } from './fixAttemptFlow.data'
import { FixStageNode } from './FixStageNode'
import { PdcaGradientEdge } from '../pdca-flow/PdcaGradientEdge'

const NODE_TYPES = { fixStage: FixStageNode }
const EDGE_TYPES = { pdcaGradient: PdcaGradientEdge }

interface FixAttemptFlowProps {
  fix: FixAttempt
  className?: string
}

export function FixAttemptFlow({ fix, className = '' }: FixAttemptFlowProps) {
  const nodes: Node<FixStageNodeData>[] = useMemo(() => buildFixAttemptNodes(fix), [fix])
  const edges: Edge<FixEdgeData>[] = useMemo(() => buildFixAttemptEdges(fix), [fix])

  return (
    <div
      className={`relative w-full h-[98px] rounded-sm border border-edge/40 bg-surface-raised/20 overflow-hidden ${className}`.trim()}
      role="group"
      aria-label={`Fix attempt pipeline for ${fix.id}`}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.1, includeHiddenNodes: false }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          minZoom={0.5}
          maxZoom={1}
          defaultEdgeOptions={{ type: 'pdcaGradient' }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={12}
            size={0.8}
            color="var(--color-edge-subtle)"
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
