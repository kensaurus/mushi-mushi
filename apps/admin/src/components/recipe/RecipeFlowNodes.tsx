/**
 * FILE: apps/admin/src/components/recipe/RecipeFlowNodes.tsx
 * PURPOSE: Custom React Flow nodes for the Recipe canvas — the element card
 *          (with four invisible handles so edges can enter from any side) and
 *          the non-interactive lane heading.
 */

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { RecipeElementCard } from './RecipeElementCard'
import type { RecipeLaneNodeData, RecipeNodeData } from './recipeFlow.data'

const HANDLE_CLS = '!h-1.5 !w-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent'

function RecipeElementNodeInner({ data }: NodeProps) {
  const node = data as RecipeNodeData
  return (
    <div className="relative">
      <Handle id="t" type="target" position={Position.Top} className={HANDLE_CLS} isConnectable={false} />
      <Handle id="l" type="target" position={Position.Left} className={HANDLE_CLS} isConnectable={false} />
      <RecipeElementCard
        element={node.element}
        selected={node.selected}
        onSelect={node.onSelect}
        layout="canvas"
      />
      <Handle id="r" type="source" position={Position.Right} className={HANDLE_CLS} isConnectable={false} />
      <Handle id="b" type="source" position={Position.Bottom} className={HANDLE_CLS} isConnectable={false} />
    </div>
  )
}

export const RecipeElementNode = memo(RecipeElementNodeInner)

function RecipeLaneNodeInner({ data }: NodeProps) {
  const lane = data as RecipeLaneNodeData
  return (
    <div className="pointer-events-none flex flex-col gap-0.5 border-b border-edge-subtle pb-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">{lane.label}</span>
      <span className="text-2xs text-fg-faint">{lane.hint}</span>
    </div>
  )
}

export const RecipeLaneNode = memo(RecipeLaneNodeInner)
