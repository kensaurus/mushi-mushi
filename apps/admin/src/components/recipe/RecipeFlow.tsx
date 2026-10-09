/**
 * FILE: apps/admin/src/components/recipe/RecipeFlow.tsx
 * PURPOSE: Fixed-layout React Flow canvas for the App Recipe (Plan 019 §3).
 *          Nodes never move. The canvas opens at 100% (never zoomed out
 *          below RECIPE_MIN_ZOOM, so text stays at 12 px or more), anchored
 *          top-left, and pans within the diagram when the column is narrower
 *          than the four lanes. Selecting a card is the card's own <button>,
 *          so keyboard users reach every element without React Flow's node
 *          focus model. Lazy-loaded by RecipePage so list-mode visitors skip
 *          the bundle.
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { RecipeElementKey, RecipeElementSummary } from '../../lib/recipeTypes'
import { FlowCanvasBackground } from '../flow-primitives/FlowCanvasBackground'
import { RECIPE_MAX_ZOOM, RECIPE_MIN_ZOOM, buildRecipeEdges, buildRecipeNodes, recipeDiagramBounds } from './recipeFlow.data'
import { RecipeElementNode, RecipeLaneNode } from './RecipeFlowNodes'

const NODE_TYPES = { recipeElement: RecipeElementNode, recipeLane: RecipeLaneNode }
/** Gap kept around the diagram, in px. */
const EDGE_PAD = 16
const BOUNDS = recipeDiagramBounds()
const DEFAULT_VIEWPORT = { x: EDGE_PAD - BOUNDS.minX, y: EDGE_PAD - BOUNDS.minY, zoom: RECIPE_MIN_ZOOM }
const TRANSLATE_EXTENT: [[number, number], [number, number]] = [
  [BOUNDS.minX - EDGE_PAD, BOUNDS.minY - EDGE_PAD],
  [BOUNDS.maxX + EDGE_PAD, BOUNDS.maxY + EDGE_PAD],
]

interface RecipeFlowProps {
  elements: RecipeElementSummary[]
  selectedKey: RecipeElementKey | null
  onSelect: (key: RecipeElementKey) => void
}

/** True while the container is narrower than the diagram at 100%, so some lanes are off screen. */
function useOverflows(ref: RefObject<HTMLDivElement | null>): boolean {
  const [overflows, setOverflows] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const check = () => setOverflows(el.clientWidth < BOUNDS.width + EDGE_PAD * 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return overflows
}

export function RecipeFlow({ elements, selectedKey, onSelect }: RecipeFlowProps) {
  const nodes = useMemo(
    () => buildRecipeNodes(elements, selectedKey, onSelect),
    [elements, selectedKey, onSelect],
  )
  const edges = useMemo(() => buildRecipeEdges(elements), [elements])
  const ref = useRef<HTMLDivElement>(null)
  const overflows = useOverflows(ref)

  return (
    <div className="flex flex-col gap-1.5">
      {overflows && (
        <p className="text-xs text-fg-muted" role="note">
          Drag the diagram sideways to see every lane, or switch to List to see every card at once.
        </p>
      )}
      <div
        ref={ref}
        className="flow-canvas-chrome relative h-232 w-full overflow-hidden rounded-md"
        role="region"
        aria-label="App recipe diagram: Sources, Build, Deploy and Runtime lanes. Each card is a button that opens its details."
      >
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            defaultViewport={DEFAULT_VIEWPORT}
            translateExtent={TRANSLATE_EXTENT}
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
            minZoom={RECIPE_MIN_ZOOM}
            maxZoom={RECIPE_MAX_ZOOM}
          >
            <FlowCanvasBackground density="pipeline" />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  )
}
