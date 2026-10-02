/**
 * FILE: apps/admin/src/components/recipe/RecipeFlow.tsx
 * PURPOSE: Fixed-layout React Flow canvas for the App Recipe (Plan 019 §3).
 *          Nodes never move; the canvas only fits itself to the container.
 *          Selecting a card is the card's own <button>, so keyboard users
 *          reach every element without React Flow's node focus model.
 *          Lazy-loaded by RecipePage so list-mode visitors skip the bundle.
 */

import { useMemo } from 'react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { RecipeElementKey, RecipeElementSummary } from '../../lib/recipeTypes'
import { FlowCanvasBackground } from '../flow-primitives/FlowCanvasBackground'
import { buildRecipeEdges, buildRecipeNodes } from './recipeFlow.data'
import { RecipeElementNode, RecipeLaneNode } from './RecipeFlowNodes'

const NODE_TYPES = { recipeElement: RecipeElementNode, recipeLane: RecipeLaneNode }
const FIT_PADDING = 0.06

interface RecipeFlowProps {
  elements: RecipeElementSummary[]
  selectedKey: RecipeElementKey | null
  onSelect: (key: RecipeElementKey) => void
}

export function RecipeFlow({ elements, selectedKey, onSelect }: RecipeFlowProps) {
  const nodes = useMemo(
    () => buildRecipeNodes(elements, selectedKey, onSelect),
    [elements, selectedKey, onSelect],
  )
  const edges = useMemo(() => buildRecipeEdges(elements), [elements])

  return (
    <div
      className="flow-canvas-chrome relative h-176 w-full overflow-hidden rounded-md"
      role="region"
      aria-label="App recipe diagram: Sources, Build, Deploy and Runtime lanes. Each card is a button that opens its details."
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: FIT_PADDING }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          panOnDrag
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          preventScrolling={false}
          minZoom={0.4}
          maxZoom={1.25}
        >
          <FlowCanvasBackground density="pipeline" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}

