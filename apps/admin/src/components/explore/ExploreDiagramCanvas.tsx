/**
 * React Flow drawing of the AI architecture diagram. Positions come from the
 * server's deterministic layout (_shared/repo-diagram.ts), so nothing moves
 * between renders and the public page matches this picture.
 */

import { useMemo } from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type NodeMouseHandler,
  type NodeProps,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  diagramToFlow,
  type DiagramFlowData,
  type DiagramGraph,
  type DiagramOverlayResponse,
} from '../../lib/repoUnderstanding'

function DiagramGroupNode({ data }: NodeProps<Node<DiagramFlowData>>) {
  return (
    <div className="h-full w-full rounded-md border border-edge-subtle bg-surface-raised/40">
      <div className="px-3 pt-2 text-2xs font-semibold uppercase tracking-wider text-fg-muted">{data.label}</div>
    </div>
  )
}

function DiagramComponentNode({ data }: NodeProps<Node<DiagramFlowData>>) {
  const tone = data.selected
    ? 'border-brand bg-brand/10'
    : data.pathInvalid
      ? 'border-dashed border-warn/60 bg-surface-raised'
      : 'border-edge bg-surface-raised'
  return (
    <div
      className={`h-full w-full rounded-sm border px-2.5 py-1.5 text-left shadow-card ${tone}`}
      title={data.description || data.label}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-transparent" />
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{data.label}</div>
        {(data.reportCount ?? 0) > 0 && (
          <span
            className="shrink-0 rounded-sm bg-danger/15 px-1 text-3xs font-semibold text-danger"
            title={`${data.reportCount} open bug report${data.reportCount === 1 ? '' : 's'}`}
            data-testid="diagram-node-reports"
          >
            {data.reportCount} bug{data.reportCount === 1 ? '' : 's'}
          </span>
        )}
        {(data.findingCount ?? 0) > 0 && (
          <span
            className="shrink-0 rounded-sm bg-warn/15 px-1 text-3xs font-semibold text-warn"
            title={`${data.findingCount} code finding${data.findingCount === 1 ? '' : 's'}`}
            data-testid="diagram-node-findings"
          >
            {data.findingCount} finding{data.findingCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="truncate font-mono text-3xs text-fg-faint">
        {data.path ?? (data.pathInvalid ? 'path not found in the repo' : 'no single path')}
      </div>
    </div>
  )
}

const NODE_TYPES = { diagramGroup: DiagramGroupNode, diagramComponent: DiagramComponentNode }

interface Props {
  graph: DiagramGraph
  selectedId: string | null
  onSelect: (id: string | null) => void
  overlay?: DiagramOverlayResponse | null
}

export function ExploreDiagramCanvas({ graph, selectedId, onSelect, overlay = null }: Props) {
  const { nodes, edges } = useMemo(() => diagramToFlow(graph, selectedId, overlay), [graph, selectedId, overlay])
  const onNodeClick: NodeMouseHandler = (_e, node) => {
    if (node.type === 'diagramComponent') onSelect(node.id)
  }
  return (
    <div className="h-[560px] w-full overflow-hidden rounded-md border border-edge-subtle" data-testid="explore-diagram-canvas">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          onPaneClick={() => onSelect(null)}
          nodesConnectable={false}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
