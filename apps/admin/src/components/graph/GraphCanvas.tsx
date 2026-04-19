/**
 * FILE: apps/admin/src/components/graph/GraphCanvas.tsx
 * PURPOSE: ReactFlow visualization wrapper. Owns the canvas chrome
 *          (background, controls, minimap, in-canvas hint, legend, empty
 *          panel) so the page can stay focused on data + state.
 */

import { useEffect, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import { NODE_COLORS } from '../../lib/tokens'
import { GraphLegend } from './GraphLegend'
import { ReactFlowChip } from './NodeChip'
import type { GraphNode } from './types'

interface Props {
  flowNodes: Node[]
  flowEdges: Edge[]
  filteredCount: number
  filteredEdgeCount: number
  onNodeClick: NodeMouseHandler
  onPaneClick: () => void
  onResetView: () => void
  hidden?: boolean
}

const HINT_KEY = 'mushi.graph.hintSeen'

export function GraphCanvas({
  flowNodes,
  flowEdges,
  filteredCount,
  filteredEdgeCount,
  onNodeClick,
  onPaneClick,
  onResetView,
  hidden = false,
}: Props) {
  const [hintDismissed, setHintDismissed] = useState(false)

  // Auto-fade the pan/zoom hint after 6s. Stored in localStorage so it doesn't
  // re-appear every refresh once the user has seen it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(HINT_KEY) === '1') {
      setHintDismissed(true)
      return
    }
    const t = setTimeout(() => {
      setHintDismissed(true)
      window.localStorage.setItem(HINT_KEY, '1')
    }, 6000)
    return () => clearTimeout(t)
  }, [])

  const dismissHint = () => {
    setHintDismissed(true)
    if (typeof window !== 'undefined') window.localStorage.setItem(HINT_KEY, '1')
  }

  return (
    <div
      className="border border-edge rounded-md bg-surface-root"
      style={{
        height: 'calc(100vh - 280px)',
        minHeight: 520,
        display: hidden ? 'none' : 'block',
      }}
      role="region"
      aria-label={`Knowledge graph visualization with ${filteredCount} nodes and ${filteredEdgeCount} edges. Switch to Table view for a screen-reader-friendly list.`}
      tabIndex={0}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        nodeOrigin={[0.5, 0.5]}
        nodeTypes={{ default: ReactFlowChip }}
        aria-label="Knowledge graph nodes and edges. Use Tab to focus, Enter or Space to select a node and load its blast radius."
      >
        <Background gap={24} color="oklch(0.30 0 0)" />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const data = n.data as { node?: GraphNode } | undefined
            return NODE_COLORS[data?.node?.node_type ?? ''] ?? 'oklch(0.45 0 0)'
          }}
          maskColor="oklch(0.10 0 0 / 0.6)"
          style={{ background: 'oklch(0.14 0 0)' }}
        />
        {!hintDismissed && (
          <Panel position="top-center">
            <div className="flex items-center gap-2 rounded-md border border-edge bg-surface-raised/95 backdrop-blur px-3 py-1.5 text-2xs text-fg-secondary shadow-raised">
              <span aria-hidden="true">🖱️</span>
              <span>Drag to pan · scroll to zoom · click a node for blast radius</span>
              <button
                type="button"
                onClick={dismissHint}
                className="ml-2 text-fg-faint hover:text-fg text-xs leading-none"
                aria-label="Dismiss hint"
              >
                ✕
              </button>
            </div>
          </Panel>
        )}
        <Panel position="bottom-left">
          <GraphLegend />
        </Panel>
        {filteredCount === 0 && (
          <Panel position="top-center">
            <div className="rounded-md border border-edge bg-surface-raised/95 backdrop-blur px-3 py-2 text-2xs text-fg-secondary shadow-raised max-w-sm text-center">
              <div className="font-medium text-fg mb-0.5">No nodes match these filters</div>
              <div className="text-fg-muted">
                Try the{' '}
                <button
                  type="button"
                  onClick={onResetView}
                  className="underline hover:text-fg"
                >
                  All
                </button>{' '}
                view, enable more node/edge types, or uncheck "Hide isolated nodes".
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  )
}
