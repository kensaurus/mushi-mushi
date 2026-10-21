/**
 * FILE: apps/admin/src/components/ci/CiRunnerMap.tsx
 * PURPOSE: React Flow canvas for the /ci runner map (Plan 022 Phase 4):
 *          machines → runners → repos → live jobs, laid out by
 *          `buildCiMap` (dagre, left to right). Lazy-loaded by CiPage so the
 *          flow and dagre bundles load only when the map is shown.
 *
 * Perf (reactflow.dev guidance): node and edge types are module constants,
 * custom nodes are memoized, selection travels through context so the node
 * array is rebuilt only when the overview changes.
 */

import { useMemo } from 'react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { CiOverview } from '../../lib/ciTypes'
import { FlowCanvasBackground } from '../flow-primitives/FlowCanvasBackground'
import { buildCiMap } from './ciMapLayout'
import { CiEdge, CiHostNode, CiJobNode, CiRepoNode, CiRunnerNode } from './CiMapNodes'
import { CiMapSelectContext } from './ciMapContext'

const NODE_TYPES = { 'ci-host': CiHostNode, 'ci-runner': CiRunnerNode, 'ci-repo': CiRepoNode, 'ci-job': CiJobNode }
const EDGE_TYPES = { ciEdge: CiEdge }
const FIT_VIEW_OPTIONS = { padding: 0.08, maxZoom: 1, minZoom: 0.55 }
const PRO_OPTIONS = { hideAttribution: true }

interface Props {
  overview: CiOverview
  selectedId: string | null
  onSelect: (nodeId: string) => void
}

export function CiRunnerMap({ overview, selectedId, onSelect }: Props) {
  const map = useMemo(() => buildCiMap(overview), [overview])
  const selection = useMemo(() => ({ selectedId, onSelect }), [selectedId, onSelect])
  // Tall enough for the longest column at 100%, within the viewport.
  const heightPx = Math.min(720, Math.max(320, map.height + 48))

  return (
    <CiMapSelectContext.Provider value={selection}>
      <div
        className="flow-canvas-chrome relative w-full overflow-hidden rounded-md"
        style={{ height: heightPx }}
        role="region"
        aria-label="Runner map: machines, then runners, then repositories, then jobs waiting or running now. Each card is a button that opens its details."
      >
        <ReactFlowProvider>
          <ReactFlow
            nodes={map.nodes}
            edges={map.edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            proOptions={PRO_OPTIONS}
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
    </CiMapSelectContext.Provider>
  )
}
