/**
 * FILE: apps/admin/src/components/graph/NodeChip.tsx
 * PURPOSE: Visual chip used as the React Flow node renderer. Two exports:
 *          - `NodeChip` for direct use in tables/legends
 *          - `ReactFlowChip` adapter that React Flow passes as nodeType
 */

import { Handle, Position } from '@xyflow/react'
import { NODE_COLORS } from '../../lib/tokens'
import { nodeMetadataValue, NODE_TYPE_LABELS, type GraphNode } from './types'

interface Props {
  node: GraphNode
  selected: boolean
}

// Visually distinguish report_groups (incident clusters) from
// structural nodes (component/page) — squarer for groups, rounded for
// structure. Done with className not style so dark/light themes work.
function nodeShape(node_type: string): string {
  if (node_type === 'report_group') return 'rounded-md'
  return 'rounded-full'
}

export function NodeChip({ node, selected }: Props) {
  const occ = nodeMetadataValue(node, 'occurrence_count')
  const color = NODE_COLORS[node.node_type] ?? 'oklch(0.55 0 0)'
  const ring = selected ? 'ring-2 ring-fg shadow-raised' : 'ring-1 ring-edge'
  const shape = nodeShape(node.node_type)
  return (
    <div
      className={`px-2.5 py-1 text-2xs leading-tight font-medium text-fg bg-surface-raised ${shape} ${ring} max-w-[200px]`}
      title={`${NODE_TYPE_LABELS[node.node_type] ?? node.node_type}: ${node.label}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-2 !h-2" />
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="truncate">{node.label}</span>
        {occ != null && (
          <span className="text-3xs text-fg-faint font-mono shrink-0">×{occ}</span>
        )}
      </div>
    </div>
  )
}

export function ReactFlowChip({ data }: { data: { node: GraphNode; isSelected: boolean } }) {
  return <NodeChip node={data.node} selected={data.isSelected} />
}
