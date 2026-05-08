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
import { useTheme } from '../../lib/useTheme'
import { GraphLegend } from './GraphLegend'
import { ReactFlowChip } from './NodeChip'
import { GraphSidePanel } from './GraphSidePanel'
import type { BlastRadiusItem, GraphNode } from './types'

// Minimap + dot-grid colours are passed straight to SVG attrs by xyflow,
// which strips `var(--…)` references — so we resolve them per-theme here
// instead of trying to live inside CSS custom properties.
const MINIMAP_COLORS = {
  dark: {
    background: 'oklch(0.215 0.007 285)',
    mask: 'oklch(0.10 0 0 / 0.55)',
    border: 'oklch(0.30 0.005 285)',
  },
  light: {
    background: 'oklch(0.97 0.003 285)',
    mask: 'oklch(0.55 0.005 285 / 0.18)',
    border: 'oklch(0.85 0.004 285)',
  },
} as const

const DOT_GRID_COLORS = {
  dark: 'oklch(0.30 0 0)',
  light: 'oklch(0.86 0.004 285)',
} as const

interface Props {
  flowNodes: Node[]
  flowEdges: Edge[]
  filteredCount: number
  filteredEdgeCount: number
  onNodeClick: NodeMouseHandler
  onPaneClick: () => void
  onResetView: () => void
  hidden?: boolean
  /** When false, the minimap is suppressed — useful on small graphs where it
   *  adds visual clutter without helping orientation. Defaults to true. */
  showMinimap?: boolean
  // 2026-05-07 — selection panel now floats *inside* the ReactFlow
  // viewport (top-right) instead of as a sibling 18rem column. This keeps
  // the canvas full-width (the user's reported "wasted space" was the
  // sibling column eating ~25 % of horizontal real estate even when no
  // node was selected) and means clicks reveal context without the eye
  // jumping outside the spatial map.
  selectedNode?: GraphNode | null
  blastRadius?: BlastRadiusItem[]
  blastLoading?: boolean
  onClearSelection?: () => void
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
  showMinimap = true,
  selectedNode = null,
  blastRadius = [],
  blastLoading = false,
  onClearSelection,
}: Props) {
  const [hintDismissed, setHintDismissed] = useState(false)
  const { resolved } = useTheme()
  const minimap = MINIMAP_COLORS[resolved]
  const dotGrid = DOT_GRID_COLORS[resolved]

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
      // 2026-05-07 — height tightened from `100vh-280` / min 520 to
      // `100vh-360` / min 440. The user reported "the height is a little
      // too big"; the prior numbers were sized for a viewport without the
      // PageHero + filter chips above the canvas. Subtracting another
      // ~80 px restores ~1.1 viewport-folds of canvas at 1440×900 instead
      // of overflowing to ~1.4 folds and forcing a vertical scroll just to
      // reach the legend / minimap controls. min-height stays generous
      // enough for the storyboard threshold (12 nodes laid out by force).
      className="border border-edge rounded-md bg-surface-root"
      style={{
        height: 'calc(100vh - 360px)',
        minHeight: 440,
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
        <Background gap={24} color={dotGrid} />
        <Controls position="bottom-right" showInteractive={false} />
        {showMinimap && (
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              const data = n.data as { node?: GraphNode } | undefined
              return NODE_COLORS[data?.node?.node_type ?? ''] ?? 'oklch(0.55 0.005 285)'
            }}
            nodeStrokeColor={minimap.border}
            nodeStrokeWidth={1.5}
            maskColor={minimap.mask}
            style={{
              background: minimap.background,
              border: `1px solid ${minimap.border}`,
              borderRadius: 6,
            }}
          />
        )}
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
        {selectedNode && onClearSelection && (
          // In-canvas detail panel.
          // Wrapped in a fixed-width track so the floating card never
          // exceeds ~22rem regardless of node label length (long labels
          // truncate inside the panel via `wrap-break-word`). Pointer
          // events: auto so the panel intercepts clicks (otherwise the
          // ReactFlow `onPaneClick` swallows them and the user can't
          // scroll the blast-radius list). Max-h leaves headroom above
          // the bottom-right Controls overlay.
          <Panel position="top-right">
            <div className="w-[22rem] max-w-[calc(100vw-3rem)] max-h-[min(70%,28rem)] overflow-y-auto rounded-md shadow-raised pointer-events-auto">
              <GraphSidePanel
                node={selectedNode}
                blastRadius={blastRadius}
                blastLoading={blastLoading}
                onClear={onClearSelection}
              />
            </div>
          </Panel>
        )}
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
