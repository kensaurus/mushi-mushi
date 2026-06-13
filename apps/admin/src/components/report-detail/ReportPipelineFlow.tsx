/**
 * Horizontal React Flow pipeline for a single report — mirrors FixAttemptFlow
 * but tracks the full bug journey from SDK submit through ship.
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
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail } from './types'
import { FixStageNode } from '../fixes/FixStageNode'
import { PdcaGradientEdge } from '../pdca-flow/PdcaGradientEdge'
import type { FixEdgeData, FixStageNodeData } from '../fixes/fixAttemptFlow.data'
import { buildReportPipelineEdges, buildReportPipelineNodes } from './reportPipelineFlow.data'

const NODE_TYPES = { fixStage: FixStageNode }
const EDGE_TYPES = { pdcaGradient: PdcaGradientEdge }

interface Props {
  report: ReportDetail
  dispatchState: DispatchState
  className?: string
}

export function ReportPipelineFlow({ report, dispatchState, className = '' }: Props) {
  const nodes: Node<FixStageNodeData>[] = useMemo(
    () => buildReportPipelineNodes(report, dispatchState),
    [report, dispatchState],
  )
  const edges: Edge<FixEdgeData>[] = useMemo(
    () => buildReportPipelineEdges(report, dispatchState),
    [report, dispatchState],
  )

  return (
    <div
      className={`relative w-full h-[108px] rounded-sm border border-edge/40 bg-surface-raised/20 overflow-hidden mb-3 ${className}`.trim()}
      role="group"
      aria-label={`Report pipeline for ${report.id}`}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.12, includeHiddenNodes: false }}
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
          minZoom={0.45}
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
